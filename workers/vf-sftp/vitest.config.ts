import { defineConfig } from "vitest/config";

/**
 * vf-sftp's tests run the container's runner in Node against an SFTP
 * server of their own (ssh2's server, in memory) — decision 0620. The
 * Worker itself only passes requests through, so it is not run here.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    testTimeout: 20_000,
  },
});
