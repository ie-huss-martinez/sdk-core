/**
 * The editor in Next.js: a Server Component page around a client component,
 * rendered for each request so it carries the request's nonce.
 */
import { connection } from "next/server";
import content from "../../../thai-basics.json" with { type: "json" };
import { Example } from "./example";

export default async function Page() {
  await connection();
  return (
    <main>
      <h1>The learn-sdk editor, rendered on the server</h1>
      <Example content={content} />
    </main>
  );
}
