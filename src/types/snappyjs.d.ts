declare module 'snappyjs' {
  export function compress(input: Uint8Array | ArrayBuffer): Uint8Array;
  export function uncompress(input: Uint8Array | ArrayBuffer): Uint8Array;
}
