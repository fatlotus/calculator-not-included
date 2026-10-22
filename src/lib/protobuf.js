/**
 * Protobuf.js ES Module wrapper for ONI Math.
 * Provides unified access across browser and Node.js environments.
 * If global protobuf already exists (e.g. from index.html script tag), it reuses it.
 */
if (!globalThis.protobuf) {
  await import("./protobuf.min.js");
}

const protobuf = globalThis.protobuf;

if (!protobuf) {
  throw new Error("Failed to initialize protobuf.js: global protobuf object not found");
}

export default protobuf;
export { protobuf };
