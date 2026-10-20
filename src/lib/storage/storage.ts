import fs from "fs/promises";
import path from "path";
import { env } from "../env";
import { log } from "../logger";

/**
 * Private object storage.
 *
 * All stored bytes are encrypted by the application (AES-256-GCM with the
 * vault DEK) BEFORE they reach this layer, so:
 *   - local driver: files on disk are ciphertext
 *   - s3 driver: objects are ciphertext with SSE additionally enabled when supported
 * There are no public bucket URLs and no presigned links; every download goes
 * through an authenticated, authorized endpoint that decrypts after checks.
 */

export interface ObjectStorage {
  driver: "local" | "s3";
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

const KEY_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9/._-]*$/;

/** Server-generated keys only: validates shape and rejects traversal. */
export function assertSafeKey(key: string): void {
  if (!KEY_PATTERN.test(key) || key.includes("..") || key.includes("//")) {
    throw new Error("Invalid storage key");
  }
}

export function newDocumentKey(vaultId: string, documentId: string): string {
  if (!/^[0-9a-f-]{36}$/.test(vaultId) || !/^[0-9a-f-]{36}$/.test(documentId)) {
    throw new Error("Invalid identifiers for storage key");
  }
  return `v/${vaultId}/${documentId}.bin`;
}

class LocalDiskStorage implements ObjectStorage {
  driver = "local" as const;
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = path.resolve(baseDir);
  }

  private resolve(key: string): string {
    assertSafeKey(key);
    const full = path.resolve(this.baseDir, key);
    if (!full.startsWith(this.baseDir + path.sep)) throw new Error("Storage key escapes base directory");
    return full;
  }

  async put(key: string, data: Buffer): Promise<void> {
    const full = this.resolve(key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, data, { mode: 0o600 });
    await fs.rename(tmp, full);
  }

  async get(key: string): Promise<Buffer> {
    return fs.readFile(this.resolve(key));
  }

  async delete(key: string): Promise<void> {
    try {
      await fs.unlink(this.resolve(key));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.resolve(key));
      return true;
    } catch {
      return false;
    }
  }

  async probe(): Promise<boolean> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
      const probePath = path.join(this.baseDir, ".probe");
      await fs.writeFile(probePath, String(Date.now()));
      await fs.unlink(probePath);
      return true;
    } catch {
      return false;
    }
  }
}

class S3Storage implements ObjectStorage {
  driver = "s3" as const;

  private async client() {
    const { S3Client } = await import("@aws-sdk/client-s3");
    const e = env();
    if (!e.S3_BUCKET) throw new Error("S3_BUCKET is not configured");
    return {
      client: new S3Client({
        region: e.S3_REGION ?? "auto",
        endpoint: e.S3_ENDPOINT || undefined,
        forcePathStyle: Boolean(e.S3_ENDPOINT),
        credentials: {
          accessKeyId: e.S3_ACCESS_KEY_ID ?? "",
          secretAccessKey: e.S3_SECRET_ACCESS_KEY ?? "",
        },
      }),
      bucket: e.S3_BUCKET,
    };
  }

  async put(key: string, data: Buffer): Promise<void> {
    assertSafeKey(key);
    const { client, bucket } = await this.client();
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: data,
        ContentType: "application/octet-stream",
        ServerSideEncryption: "AES256",
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    assertSafeKey(key);
    const { client, bucket } = await this.client();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error("Object has no body");
    const bytes = await res.Body.transformToByteArray();
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    assertSafeKey(key);
    const { client, bucket } = await this.client();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.get(key);
      return true;
    } catch {
      return false;
    }
  }
}

let storage: ObjectStorage | null = null;

export function getStorage(): ObjectStorage {
  if (!storage) {
    const e = env();
    storage = e.STORAGE_DRIVER === "s3" ? new S3Storage() : new LocalDiskStorage(e.STORAGE_LOCAL_DIR);
  }
  return storage;
}

export async function storageStatus(): Promise<{ driver: string; ok: boolean; detail: string }> {
  const s = getStorage();
  if (s.driver === "local") {
    const ok = await (s as LocalDiskStorage).probe().catch(() => false);
    return { driver: "local", ok, detail: ok ? "local directory writable" : "local storage directory is not writable" };
  }
  // S3: probe with a tiny object round-trip.
  const key = ".probe/health";
  try {
    await s.put(key, Buffer.from(String(Date.now())));
    await s.delete(key);
    return { driver: "s3", ok: true, detail: "s3 round-trip succeeded" };
  } catch (err) {
    log.warn("storage_probe_failed", { error: err instanceof Error ? err.message : "unknown" });
    return { driver: "s3", ok: false, detail: "s3 probe failed (check credentials and bucket)" };
  }
}
