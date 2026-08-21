import { Schema } from "effect";

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

const DocumentationModelSchema = Schema.Struct({
  methods: Schema.Array(NonEmptyString),
  model: NonEmptyString,
});

export const DocumentationIndexSchema = Schema.Struct({
  models: Schema.Array(DocumentationModelSchema),
  modules: Schema.Array(NonEmptyString),
});

export type DocumentationIndex = Schema.Schema.Type<typeof DocumentationIndexSchema>;

const MethodDocumentationSchema = Schema.Struct({
  api: Schema.optionalKey(Schema.Array(NonEmptyString)),
});

export const ModelDocumentationSchema = Schema.Struct({
  methods: Schema.Record(Schema.String, MethodDocumentationSchema),
  model: NonEmptyString,
});

export type ModelDocumentation = Schema.Schema.Type<typeof ModelDocumentationSchema>;
