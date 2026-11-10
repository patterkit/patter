// The audio take stamps (#224), from @patterkit/core so Patterpad's renderer and main process, ops, and the CLI
// share one implementation: the text hash a take was made from (`PTRK`, read from the older `DINK` too), and
// Placeholder Speech's request hash (`PTPS`). Pure byte work, so it runs in both processes.
export { textHash, readTextStamp, readGeneratedStamp, readInfoChunks, infoListChunk, withStamps, isWav, TEXT_STAMP, GENERATED_STAMP } from "@patterkit/core";
