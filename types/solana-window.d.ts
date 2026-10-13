export {};

declare global {
  interface Window {
    solana?: {
      isPhantom?: boolean;
      publicKey?: { toString(): string } | null;
      connect(): Promise<{ publicKey: { toString(): string } }>;
      signMessage(message: Uint8Array, display?: 'utf8'): Promise<{ signature: Uint8Array } | Uint8Array>;
      signTransaction?(transaction: any): Promise<any>;
    };
  }
}
