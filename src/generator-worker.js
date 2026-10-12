import { generateFloor } from './engine.js';
self.onmessage = ({ data }) => {
  try { self.postMessage({ id: data.id, floor: generateFloor(data.depth, { seed: data.seed }) }); }
  catch (error) { self.postMessage({ id: data.id, error: error.message || 'The cave could not be verified.' }); }
};
