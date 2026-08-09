export function convertUint8ArrayToString(contents) {
    const decoder = new TextDecoder('utf-8');
    return decoder.decode(contents).trim();
}
