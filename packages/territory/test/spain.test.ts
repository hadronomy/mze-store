import { describe, expect, it } from "vite-plus/test";
import { createProvinceCodeSchema, type ProvinceCodeOf, type ProvinceList } from "~/index";
import * as Spain from "~/spain";

describe("Spain Province reference data", () => {
  it("contains each of the 52 Province-level entries once", () => {
    expect(Spain.provinces).toHaveLength(52);
    expect(new Set(Spain.provinces.map(({ code }) => code)).size).toBe(52);
  });

  it("accepts only reviewed canonical codes", () => {
    for (const { code } of Spain.provinces) {
      expect(Spain.provinceCodeSchema.safeParse(code)).toMatchObject({ success: true });
    }

    expect(Spain.provinceCodeSchema.safeParse("ES-GC")).toMatchObject({ success: false });
    expect(Spain.provinceCodeSchema.safeParse("es-xx")).toMatchObject({ success: false });
    expect(Spain.provinceCodeSchema.safeParse("gc")).toMatchObject({ success: false });
    expect(Spain.provinceCodeSchema.safeParse("es-gc ")).toMatchObject({ success: false });
    expect(Spain.provinceCodeSchema.safeParse(35)).toMatchObject({ success: false });
  });

  it("fails when country reference data is invalid", () => {
    expect(() =>
      createProvinceCodeSchema("es", [
        { code: "es-gc", name: "Las Palmas" },
        { code: "es-gc", name: "Duplicate" },
      ]),
    ).toThrow("Duplicate Province code");

    expect(() =>
      Reflect.apply(createProvinceCodeSchema, undefined, [
        "es",
        [{ code: "pt-30", name: "Madeira" }],
      ]),
    ).toThrow("Invalid Province code for es");

    expect(() => createProvinceCodeSchema("es", [{ code: "es-gc", name: " " }])).toThrow(
      "must have a name",
    );

    expect(() =>
      Reflect.apply(createProvinceCodeSchema, undefined, [
        "ES",
        [{ code: "ES-TF", name: "Santa Cruz de Tenerife" }],
      ]),
    ).toThrow("Invalid country code: ES");

    expect(() =>
      Reflect.apply(createProvinceCodeSchema, undefined, [
        "es",
        [{ code: "es-TF", name: "Santa Cruz de Tenerife" }],
      ]),
    ).toThrow("Invalid Province code for es");

    expect(() =>
      Reflect.apply(createProvinceCodeSchema, undefined, [
        "es",
        [{ code: "es-", name: "Missing suffix" }],
      ]),
    ).toThrow("Invalid Province code for es");

    expect(() => Reflect.apply(createProvinceCodeSchema, undefined, ["es", []])).toThrow(
      "must not be empty",
    );
  });
});

const fixtureProvinces = [
  { code: "pt-20", name: "Açores" },
  { code: "pt-30", name: "Madeira" },
] as const satisfies ProvinceList<"pt">;

type FixtureProvinceCode = ProvinceCodeOf<typeof fixtureProvinces>;

it("infers exact country-specific types", () => {
  const fixtureProvince: FixtureProvinceCode = "pt-30";
  const spanishProvince: Spain.Province = Spain.provinces[0];

  // @ts-expect-error A code from another country cannot enter this Province list.
  const wrongCountry: ProvinceList<"pt"> = [{ code: "es-gc", name: "Las Palmas" }];

  const upperCaseSource: ProvinceList<"es"> = [
    // @ts-expect-error Province source rows use the canonical lower-case form.
    { code: "es-TF", name: "Santa Cruz de Tenerife" },
  ];

  // @ts-expect-error The Spanish schema infers the closed reviewed union.
  const unknownSpanishProvince: Spain.ProvinceCode = "es-xx";

  // @ts-expect-error Internal Province codes use lower case.
  const upperCaseSpanishProvince: Spain.ProvinceCode = "ES-TF";

  // @ts-expect-error A Province code includes its country prefix.
  const partialSpanishProvince: Spain.ProvinceCode = "tf";

  expect(fixtureProvince).toBe("pt-30");
  expect(spanishProvince.code).toBe("es-a");
  expect(wrongCountry).toBeDefined();
  expect(upperCaseSource).toBeDefined();
  expect(unknownSpanishProvince).toBe("es-xx");
  expect(upperCaseSpanishProvince).toBe("ES-TF");
  expect(partialSpanishProvince).toBe("tf");
});
