import model from "../../../research-model.js";
// Synthetic successful fixture metadata, never applied to generated snapshots.
export const sourceReceipt = source => ({ sourceUrl: source.url,
  extractorVersion: model.SOURCE_EXTRACTOR_VERSION, sourceContract: model.sourceContract(source) });
