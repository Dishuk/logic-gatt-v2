declare module 'react-native-zeroconf' {
  /** Minimal typing for the API this app uses (the package ships no declarations). */
  export default class Zeroconf {
    on(event: string, listener: (...args: unknown[]) => void): void;
    scan(type?: string, protocol?: string, domain?: string): void;
    stop(): void;
    removeDeviceListeners(): void;
  }
}
