export const RELEASE_VERSION = "3.9.7" as const;
export const RELEASE_NAME =
  "Frozen Primary Entry Authority" as const;
export const PRODUCT_NAME = "ZDJ-MITS" as const;
export const RELEASE_LABEL = `${PRODUCT_NAME} V${RELEASE_VERSION}` as const;
export const PROMPT_SCHEMA_VERSION = "V3.9.2" as const;
export const FACT_SCHEMA_VERSION = "V3.9.2" as const;
export const API_VERSION = "V3.9.7" as const;

export type BuildVersion = {
  releaseVersion: typeof RELEASE_VERSION;
  releaseName: typeof RELEASE_NAME;
  productName: typeof PRODUCT_NAME;
  promptSchemaVersion: typeof PROMPT_SCHEMA_VERSION;
  factSchemaVersion: typeof FACT_SCHEMA_VERSION;
  apiVersion: typeof API_VERSION;
};

export const BUILD_VERSION: BuildVersion = {
  releaseVersion: RELEASE_VERSION,
  releaseName: RELEASE_NAME,
  productName: PRODUCT_NAME,
  promptSchemaVersion: PROMPT_SCHEMA_VERSION,
  factSchemaVersion: FACT_SCHEMA_VERSION,
  apiVersion: API_VERSION,
};
