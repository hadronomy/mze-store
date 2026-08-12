import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import type { ProvinceCode } from "@mze-store/territory/spain";
import nock from "nock";
import { z } from "@medusajs/framework/zod";
import { seedTerritoryProbe, type SeededProbe } from "~/territory/probe";
import { seedTerritory, type SeededTerritory } from "~/territory/seed";
import { CURRENCY, SPAIN, SPAIN_DECLARATION } from "~/territory/spain";

jest.setTimeout(120 * 1000);

const PENINSULAR_PROVINCE: ProvinceCode = "es-m";
const STRIPE_EMULATOR_PORT = 4_009;
const STRIPE_PAYMENT_PROVIDER_ID = "pp_stripe_stripe";

const StripePaymentIntentFormSchema = z.looseObject({
  amount: z.coerce.number().int().positive(),
  currency: z.literal(CURRENCY),
  "metadata[session_id]": z.string().min(1),
});

type StripePaymentIntentForm = z.infer<typeof StripePaymentIntentFormSchema>;

interface StripeDecodedPaymentIntentBody {
  readonly raw: string;
  readonly form: StripePaymentIntentForm;
}

const StripePaymentIntentBodyCodec = z.codec(z.string().min(1), StripePaymentIntentFormSchema, {
  decode: (body): StripePaymentIntentForm =>
    StripePaymentIntentFormSchema.parse(Object.fromEntries(new URLSearchParams(body))),
  encode: (request) =>
    new URLSearchParams({
      amount: String(request.amount),
      currency: request.currency,
      "metadata[session_id]": request["metadata[session_id]"],
    }).toString(),
});

const StripeRequestHeadersSchema = z.object({
  authorization: z.string().startsWith("Bearer sk_"),
  contentType: z
    .string()
    .regex(/^application\/x-www-form-urlencoded(?:;|$)/, "Stripe requires a form request."),
});

type StripeRequestHeaders = z.infer<typeof StripeRequestHeadersSchema>;

function decodeStripePaymentIntentBody(body: nock.Body): StripeDecodedPaymentIntentBody {
  const raw = z.string().min(1).parse(body);
  return { form: StripePaymentIntentBodyCodec.decode(raw), raw };
}

function decodeStripeRequestHeaders(
  headers: Readonly<Record<string, string>>,
): StripeRequestHeaders {
  return StripeRequestHeadersSchema.parse({
    authorization: headers.authorization,
    contentType: headers["content-type"],
  });
}

const startStripeEmulator = async () => {
  const { createEmulator } = await import("emulate");
  return createEmulator({ service: "stripe", port: STRIPE_EMULATOR_PORT });
};

type StripeEmulator = Awaited<ReturnType<typeof startStripeEmulator>>;

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededTerritory;
    let probe: SeededProbe;
    let stripeEmulator: StripeEmulator;
    let capturedPaymentSessionId: string | undefined;

    beforeAll(async () => {
      stripeEmulator = await startStripeEmulator();
      seeded = await seedTerritory(getContainer(), SPAIN_DECLARATION);
      probe = await seedTerritoryProbe(getContainer(), seeded);
    });

    beforeEach(() => {
      stripeEmulator.reset();
      capturedPaymentSessionId = undefined;
      nock.cleanAll();
      nock.disableNetConnect();
      nock.enableNetConnect(/^(127\.0\.0\.1|localhost)(:\d+)?$/);
    });

    afterEach(() => {
      nock.cleanAll();
      nock.enableNetConnect();
    });

    afterAll(async () => {
      await stripeEmulator?.close();
    });

    it("creates a Stripe Payment Intent through the Store API", async () => {
      const stripeBridge = nock("https://api.stripe.com")
        .post("/v1/payment_intents")
        .reply(async function (_path, body) {
          const { form, raw } = decodeStripePaymentIntentBody(body);
          const headers = decodeStripeRequestHeaders(this.req.headers);
          capturedPaymentSessionId = form["metadata[session_id]"];

          const response = await fetch(`${stripeEmulator.url}/v1/payment_intents`, {
            method: "POST",
            headers: {
              Authorization: headers.authorization,
              "Content-Type": headers.contentType,
            },
            body: raw,
          });

          return [
            response.status,
            await response.text(),
            { "Content-Type": response.headers.get("content-type") ?? "application/json" },
          ];
        });
      const storeRequest = {
        headers: { "x-publishable-api-key": probe.publishableKey },
      };
      const productResponse = await api.get(
        `/store/products/${probe.productId}?region_id=${seeded.regionId}`,
        storeRequest,
      );
      const variantId = productResponse.data.product.variants[0].id;
      const cartResponse = await api.post(
        "/store/carts",
        {
          region_id: seeded.regionId,
          email: "stripe-test@mze.store",
          shipping_address: {
            first_name: "Stripe",
            last_name: "Test",
            address_1: "1 Test Street",
            city: "Madrid",
            country_code: SPAIN,
            postal_code: "28001",
            province: PENINSULAR_PROVINCE,
          },
          items: [{ variant_id: variantId, quantity: 1 }],
        },
        storeRequest,
      );
      const collectionResponse = await api.post(
        "/store/payment-collections",
        { cart_id: cartResponse.data.cart.id },
        storeRequest,
      );
      const paymentResponse = await api.post(
        `/store/payment-collections/${collectionResponse.data.payment_collection.id}/payment-sessions`,
        { provider_id: STRIPE_PAYMENT_PROVIDER_ID },
        storeRequest,
      );
      const session = paymentResponse.data.payment_collection.payment_sessions[0];

      const intentResponse = await fetch(
        `${stripeEmulator.url}/v1/payment_intents/${session.data.id}`,
        { headers: { Authorization: "Bearer sk_test_integration" } },
      );
      const intent = await intentResponse.json();

      expect(paymentResponse.status).toEqual(200);
      expect(session).toMatchObject({
        provider_id: STRIPE_PAYMENT_PROVIDER_ID,
        status: "pending",
      });
      expect(session.data.id).toMatch(/^pi_/);
      expect(capturedPaymentSessionId).toBe(session.id);
      expect(intentResponse.status).toEqual(200);
      expect(intent).toMatchObject({
        id: session.data.id,
        amount: 12_100,
        currency: CURRENCY,
        metadata: { session_id: session.id },
      });
      expect(stripeBridge.isDone()).toEqual(true);
      expect(nock.pendingMocks()).toEqual([]);
    });
  },
});
