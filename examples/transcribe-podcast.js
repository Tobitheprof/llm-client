// Transcribe and combine multiple channels of a podcast into
// a single timestamped text file with speaker names

import { OpenAI, OpenAIFastOptions } from '@dosco/llm-client';
import { PromisePool } from '@supercharge/promise-pool';
import path from 'path';
import fs from 'fs';

// Initialize OpenAI
const ai = new OpenAI(process.env.OPENAI_APIKEY, OpenAIFastOptions());
const args = process.argv.slice(2);
const audioPath = args[0];
const audioFiles = fs
  .readdirSync(args[0])
  .filter((v) => v.endsWith('.mp3'))
  .map((v) => path.join(audioPath, v));

const toTime = (sec) => new Date(sec * 1000).toISOString().slice(11, 19);
const toKeyAndIndex = (file) => {
  const v = path.parse(file).name.match(/^([^-]+)/);
  return { key: v[1], index: v[3] };
};

// Function to handle the transcription task
const transcribe = async (v) => {
  let segments;
  try {
    ({ segments } = await ai.transcribe(v));
  } catch (e) {
    throw new Error(e);
  }
  const { key, index } = toKeyAndIndex(v);

  return segments.map(({ start, end, text }) => ({
    start: toTime(start),
    end: toTime(end),
    key,
    text,
  }));
};

// Start uploading audio files for transcription 2 atn
// a time in parallel
const { results } = await PromisePool.withConcurrency(2)
  .for(audioFiles)
  .onTaskFinished((_, pool) => console.log(pool.processedPercentage()))
  .process(transcribe);

console.log(JSON.stringify(results));

// Get the transcriptions combine them and add timestamp
// and speaker name as a line prefix
const output = results
  .flat()
  .sort((a, b) => a.start - b.start)
  .map((v) => `${v.start}-${v.end},${v.key}: ${v.text}`)
  .join('\n');

// Finally save the final resulting text to a file
fs.writeFileSync(path.join(audioPath, 'transcript.txt'), output);
