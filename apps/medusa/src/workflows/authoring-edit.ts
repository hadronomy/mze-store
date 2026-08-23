import {
  createStep,
  createWorkflow,
  StepResponse,
  WorkflowResponse,
} from "@medusajs/framework/workflows-sdk";
import {
  PRODUCT_AUTHORING_MODULE,
  type ProductAuthoringModuleService,
} from "~/modules/product-authoring";
import type {
  EditAuthoringInput,
  ProductAuthoringRecordView,
} from "~/modules/product-authoring/types";

const editAuthoringStep = createStep(
  "edit-authoring",
  async (
    input: EditAuthoringInput,
    { container },
  ): Promise<StepResponse<ProductAuthoringRecordView>> => {
    const authoring = container.resolve<ProductAuthoringModuleService>(PRODUCT_AUTHORING_MODULE);
    const record = await authoring.editAuthoring(input);

    return new StepResponse(record);
  },
);

export const editAuthoringWorkflow = createWorkflow<
  EditAuthoringInput,
  ProductAuthoringRecordView,
  unknown[]
>("edit-authoring", function (input) {
  return new WorkflowResponse(editAuthoringStep(input));
});
