import { medusaIntegrationTestRunner } from "@medusajs/test-utils";
import nock from "nock";
import { seedTerritoryProbe, type SeededProbe } from "../../src/territory/probe";
import { seedSpanishTerritory, type SeededTerritory } from "../../src/territory/seed";
import { CURRENCY, SPAIN } from "../../src/territory/spain";
import { createEmulator, type Emulator } from "../utils/emulate.cjs";

jest.setTimeout(120 * 1000);

const PENINSULAR_PROVINCE = "es-m";
const STRIPE_EMULATOR_PORT = 4_009;
const STRIPE_PAYMENT_PROVIDER_ID = "pp_stripe_stripe";

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  testSuite: ({ api, getContainer }) => {
    let seeded: SeededTerritory;
    let probe: SeededProbe;
    let stripeEmulator: Emulator;

    beforeAll(async () => {
      stripeEmulator = await createEmulator({ service: "stripe", port: STRIPE_EMULATOR_PORT });
      seeded = await seedSpanishTerritory(getContainer());
      probe = await seedTerritoryProbe(getContainer(), seeded);
    });

    beforeEach(() => {
      stripeEmulator.reset();
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
          const authorization = this.req.headers.authorization;
          const contentType = this.req.headers["content-type"];

          if (typeof body !== "string") {
            throw new Error("Stripe sent a Payment Intent body that the test cannot forward");
          }
          if (typeof authorization !== "string" || typeof contentType !== "string") {
            throw new Error("Stripe sent a Payment Intent request without its required headers");
          }

          const response = await fetch(`${stripeEmulator.url}/v1/payment_intents`, {
            method: "POST",
            headers: {
              Authorization: authorization,
              "Content-Type": contentType,
            },
            body,
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
