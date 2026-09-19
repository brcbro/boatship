// The root request is rewritten to the static marketing document in
// `next.config.ts`. Keeping a minimal route module lets Next.js generate a
// complete route manifest without shipping a homepage client bundle.
export default function HomePage() {
  return null;
}
