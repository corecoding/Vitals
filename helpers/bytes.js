const decoder = new TextDecoder('utf-8'); // reuse across File.read calls
export function convertUint8ArrayToString(contents) {
    return decoder.decode(contents).trim();
}
