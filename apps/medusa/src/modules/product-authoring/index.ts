import { Module } from "@medusajs/framework/utils";
import ProductAuthoringModuleService from "./service";
import { PRODUCT_AUTHORING_MODULE } from "./types";

export { PRODUCT_AUTHORING_MODULE };
export { authoringError } from "./errors";
export { AUTHORING_ERROR_CODES, AUTHORING_STATES, OPERATOR_AUTHORING_STATES } from "./types";
export type {
  AuthoringErrorCode,
  AuthoringState,
  EditAuthoringInput,
  EnsureAuthoringInput,
  OperatorAuthoringState,
  ProductAuthoringRecordView,
} from "./types";
export type { default as ProductAuthoringModuleService } from "./service";

export default Module(PRODUCT_AUTHORING_MODULE, {
  service: ProductAuthoringModuleService,
});
