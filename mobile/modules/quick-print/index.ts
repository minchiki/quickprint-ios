import { requireOptionalNativeModule } from "expo-modules-core";

type Native = {
  sharedStorageAvailable(): Promise<boolean>;
  setPrinter(name: string): Promise<void>;
  connection(): Promise<string>;
  pair(raw: string): Promise<string>;
  request(path: string, method: string): Promise<string>;
  upload(uri: string, path: string, key: string): Promise<string>;
  forget(): Promise<void>;
  pages(uri: string): Promise<number | null>;
  preview(uri: string): Promise<void>;
  discover(): Promise<{ name: string; host: string; port: string }[]>;
};
const native = requireOptionalNativeModule<Native>("QuickPrint");
export function bridge(): Native {
  if (!native)
    throw new Error(
      "Для QuickPrint нужна сборка iOS с нативным модулем. Expo Go не поддерживается.",
    );
  return native;
}
