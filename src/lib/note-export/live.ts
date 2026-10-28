// The latest text of the note being edited on screen (the editor saves 1 s after typing stops),
// so Copy / Export never miss the last words. Key: the note id, or "block:<name>" for block notes.
const live = new Map<string, { title?: string; content: string }>();

export const setLiveNote = (key: string, v: { title?: string; content: string }) => void live.set(key.toLowerCase(), v);
export const getLiveNote = (key: string) => live.get(key.toLowerCase());
