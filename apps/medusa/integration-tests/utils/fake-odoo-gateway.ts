import type {
  OdooBridgeGateway,
  ReadCatalogBatchOptions,
  ReadCatalogBatchResult,
} from "@mze-store/odoo-bridge";
import type { CatalogBatchEncoded } from "@mze-store/odoo-bridge/contract";
import { Result, decodeCatalogBatch } from "@mze-store/odoo-bridge";

export class FakeOdooBridgeGateway implements OdooBridgeGateway {
  readonly calls: ReadCatalogBatchOptions[] = [];
  readonly #responses: ReadCatalogBatchResult[] = [];

  enqueueBatch(batch: CatalogBatchEncoded): void {
    this.#responses.push(Result.succeed(decodeCatalogBatch(batch)));
  }

  enqueueResult(result: ReadCatalogBatchResult): void {
    this.#responses.push(result);
  }

  reset(): void {
    this.calls.length = 0;
    this.#responses.length = 0;
  }

  assertDrained(): void {
    expect(this.#responses).toHaveLength(0);
  }

  async readCatalogBatch(options: ReadCatalogBatchOptions = {}): Promise<ReadCatalogBatchResult> {
    this.calls.push(options);
    const response = this.#responses.shift();
    if (!response) {
      throw new Error("The fake Odoo Bridge Gateway has no queued Catalog Batch result.");
    }

    return response;
  }
}
