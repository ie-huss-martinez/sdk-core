import { createWindowReader } from "@hussmartinez/sdk-core";
import { VideoError } from "../../core/errors/video-error.js";
import type {
  AudioPacket,
  AudioPackets,
  OpenTracks,
  PacketWalk,
  VideoPacket,
  VideoPackets,
} from "../packets.js";
import { peakPerSecond } from "../packets.js";
import type { DhavIndex, PacketIndex } from "./scan.js";

/** One packet of a DHAV file: its place in the index, and its payload. */
class DhavPacket implements VideoPacket, AudioPacket {
  readonly index: number;
  readonly type: "key" | "delta";
  readonly microsecondTimestamp: number;
  private readonly duration: number;
  private readonly data: Uint8Array;

  constructor(
    index: number,
    type: "key" | "delta",
    microsecondTimestamp: number,
    duration: number,
    data: Uint8Array,
  ) {
    this.index = index;
    this.type = type;
    this.microsecondTimestamp = microsecondTimestamp;
    this.duration = duration;
    this.data = data;
  }

  toEncodedVideoChunk(): EncodedVideoChunk {
    // Annex B, as the recorder wrote it: a decoder configured without a
    // description takes it as it is (docs/adr/0009).
    return new EncodedVideoChunk({
      type: this.type,
      timestamp: this.microsecondTimestamp,
      duration: this.duration,
      data: this.data,
    });
  }

  toEncodedAudioChunk(): EncodedAudioChunk {
    return new EncodedAudioChunk({
      type: "key",
      timestamp: this.microsecondTimestamp,
      duration: this.duration,
      data: this.data,
    });
  }
}

/** The last packet at or before a time in microseconds, or -1 before the first. */
function indexAt(times: Float64Array, time: number): number {
  let low = 0;
  let high = times.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((times[middle] as number) <= time) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/**
 * Reads a track's packets from the file, through a window of its own, so
 * two decodes of one file don't move each other's.
 */
function packetReader(
  file: Blob,
  track: PacketIndex,
  type: (index: number) => "key" | "delta",
  duration: (index: number) => number,
) {
  const reader = createWindowReader(file);
  const read = async (index: number): Promise<DhavPacket | null> => {
    if (index < 0 || index >= track.count) return null;
    const size = track.sizes[index] as number;
    const data = await reader.bytes(track.offsets[index] as number, size);
    if (data.length !== size) {
      throw new VideoError("INVALID_VIDEO", "The file ended inside a packet.", {
        details: { container: "dav", reason: "truncated" },
      });
    }
    return new DhavPacket(index, type(index), track.times[index] as number, duration(index), data);
  };
  return {
    read,
    at: (seconds: number) => indexAt(track.times, seconds * 1_000_000),
    next: (packet: VideoPacket | AudioPacket) =>
      packet instanceof DhavPacket ? read(packet.index + 1) : Promise.resolve(null),
  };
}

/**
 * Opens the tracks of a DHAV file from its index (docs/adr/0009). Packets
 * are read from the file when a decoder asks for them, and handed over as
 * the recorder wrote them: Annex B pictures, and plain G.711 or PCM samples.
 * Sound in any other codec has no decoder configuration, so the file opens
 * with its picture and says which sound it couldn't play (docs/adr/0008).
 *
 * @internal
 */
export function openDhavTracks(file: Blob, index: DhavIndex): OpenTracks {
  const { video, audio } = index;
  const pictureLength = (at: number) =>
    at + 1 < video.count
      ? (video.times[at + 1] as number) - (video.times[at] as number)
      : video.period;
  const videoPackets = (): VideoPackets => {
    const reader = packetReader(
      file,
      video,
      (at) => (video.keys[at] === 1 ? "key" : "delta"),
      pictureLength,
    );
    return {
      getFirstPacket: () => reader.read(0),
      getKeyPacket: (seconds) => {
        let at = reader.at(seconds);
        while (at > 0 && video.keys[at] !== 1) at -= 1;
        return reader.read(at);
      },
      getNextPacket: reader.next,
    };
  };
  const audioPackets = (sound: NonNullable<DhavIndex["audio"]>): AudioPackets => {
    const reader = packetReader(
      file,
      sound,
      () => "key",
      (at) => sound.duration(sound.sizes[at] as number),
    );
    return {
      getFirstPacket: () => reader.read(0),
      getPacket: (seconds) => reader.read(reader.at(seconds)),
      getNextPacket: reader.next,
    };
  };
  return {
    video: {
      codec: video.codec,
      config: async () => ({
        codec: video.codec,
        codedWidth: video.width,
        codedHeight: video.height,
      }),
      packets: videoPackets,
    },
    audio: audio
      ? {
          codec: audio.codec,
          config: async () =>
            audio.playable
              ? {
                  codec: audio.codec,
                  sampleRate: audio.sampleRate,
                  numberOfChannels: audio.channels,
                }
              : null,
          packets: () => audioPackets(audio),
        }
      : undefined,
    dispose: () => {},
  };
}

/**
 * What the walk of a DHAV file found (ADR 0001), from its index: the same
 * measures mediabunny's packet walk gives for the other containers. A DHAV
 * file has no header that claims a duration, so the walk's is the only one.
 *
 * @internal
 */
export function walkDhav(index: DhavIndex): PacketWalk {
  const { video, audio } = index;
  const start = video.times[0] as number;
  let end = (video.times[video.count - 1] as number) + video.period;
  let maxPacketSize = 0;
  const bytesPerSecond = new Map<number, number>();
  const count = (track: PacketIndex) => {
    for (let at = 0; at < track.count; at += 1) {
      const size = track.sizes[at] as number;
      const second = Math.floor((track.times[at] as number) / 1_000_000);
      maxPacketSize = Math.max(maxPacketSize, size);
      bytesPerSecond.set(second, (bytesPerSecond.get(second) ?? 0) + size);
    }
  };
  count(video);
  if (audio) {
    count(audio);
    for (let at = 0; at < audio.count; at += 1) {
      end = Math.max(end, (audio.times[at] as number) + audio.duration(audio.sizes[at] as number));
    }
  }
  let peakBytes = 0;
  for (const bytes of bytesPerSecond.values()) peakBytes = Math.max(peakBytes, bytes);
  return {
    start,
    duration: end - start,
    peakBitrate: peakBytes * 8,
    maxPacketSize,
    video: {
      codec: video.codec,
      codedWidth: video.width,
      codedHeight: video.height,
      displayWidth: video.width,
      displayHeight: video.height,
      rotation: 0,
      frameRate: peakPerSecond(video.times.slice()),
      packets: video.count,
    },
    audio: audio
      ? { codec: audio.codec, sampleRate: audio.sampleRate, channels: audio.channels }
      : null,
  };
}
