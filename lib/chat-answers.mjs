// The drawing and the downloads of what a chat answer carries besides text: tables, charts, survival plots, deliverables and output files (about 25
// modules with the Word, Excel and figure writers). The shell draws the transcript at once and imports this file when an answer holds blocks or a
// button needs it (app.mjs `chatAnswers`, lib/lazy.mjs); nothing else imports it.
export { renderAnswerBlocks, wireAnswerBlocks } from './chat-blocks.mjs';
export { artifactPages, artifactBlocks, artifactText, downloadArtifact, validateArtifact } from './research-artifacts.mjs';
export { outputFiles } from './output-render.mjs';
export { downloadSurvivalBlock } from './chat-survival.mjs';
