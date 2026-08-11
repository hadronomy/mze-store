import { defineRouteConfig } from "@medusajs/admin-sdk";
import { z } from "@medusajs/framework/zod";
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui";
import { useEffect, useState } from "react";
import type { EffectCallback, FormEvent, ReactNode } from "react";
import {
  TaxRateChangesResponseSchema,
  type TaxRateChangeResponse,
} from "../../../../modules/tax-rate-audit/schema";

const PAGE_SIZE = 50;

const TaxRateHistoryFormSchema = z.object({
  provinceCode: z.string(),
  taxRegionId: z.string(),
  actorId: z.string(),
  action: z.enum(["", "created", "updated"]),
  from: z.union([z.literal(""), z.string().date()]),
  to: z.union([z.literal(""), z.string().date()]),
});

type TaxRateHistoryQuery = z.infer<typeof TaxRateHistoryFormSchema> & {
  offset: number;
};

const INITIAL_QUERY: TaxRateHistoryQuery = {
  provinceCode: "",
  taxRegionId: "",
  actorId: "",
  action: "",
  from: "",
  to: "",
  offset: 0,
};

export const config = defineRouteConfig({
  label: "Tax Rate History",
});

function TaxRateHistoryPage(): ReactNode {
  const [query, setQuery] = useState<TaxRateHistoryQuery>(INITIAL_QUERY);
  const [changes, setChanges] = useState<TaxRateChangeResponse[]>([]);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function loadTaxRateChangesEffect(): ReturnType<EffectCallback> {
    const controller = new AbortController();

    async function loadTaxRateChanges(): Promise<void> {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(taxRateChangesUrl(query), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`The history request failed (${response.status}).`);
        }

        const body = TaxRateChangesResponseSchema.parse(await response.json());
        setChanges(body.tax_rate_changes);
        setCount(body.count);
      } catch (requestError) {
        if (controller.signal.aborted) {
          return;
        }

        setError(
          requestError instanceof Error ? requestError.message : "The history request failed.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadTaxRateChanges();

    return function cancelTaxRateChangesRequest(): void {
      controller.abort();
    };
  }

  useEffect(loadTaxRateChangesEffect, [query]);

  function submitFilters(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const form = TaxRateHistoryFormSchema.parse(
      Object.fromEntries(new FormData(event.currentTarget)),
    );
    setQuery({ ...form, offset: 0 });
  }

  function showPreviousPage(): void {
    setQuery(previousPage);
  }

  function showNextPage(): void {
    setQuery(nextPage);
  }

  function previousPage(current: TaxRateHistoryQuery): TaxRateHistoryQuery {
    return { ...current, offset: Math.max(0, current.offset - PAGE_SIZE) };
  }

  function nextPage(current: TaxRateHistoryQuery): TaxRateHistoryQuery {
    return { ...current, offset: current.offset + PAGE_SIZE };
  }

  const canGoBack = query.offset > 0;
  const canGoForward = query.offset + changes.length < count;

  return (
    <Container className="flex flex-col gap-6 p-6">
      <div>
        <Heading level="h1">Tax Rate History</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Review every Tax Rate create and update recorded by the system.
        </Text>
      </div>

      <form className="grid grid-cols-1 gap-3 md:grid-cols-5" onSubmit={submitFilters}>
        <Input aria-label="Province" name="provinceCode" placeholder="Province (es-tf)" />
        <Input aria-label="Tax Region ID" name="taxRegionId" placeholder="Tax Region ID" />
        <Input aria-label="Operator ID" name="actorId" placeholder="Operator ID" />
        <select
          aria-label="Action"
          className="bg-ui-bg-field border-ui-border-base text-ui-fg-base focus:border-ui-border-interactive rounded-md border px-3 py-2 text-sm"
          name="action"
          defaultValue=""
        >
          <option value="">All actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
        <Input aria-label="From date" name="from" type="date" />
        <Input aria-label="To date" name="to" type="date" />
        <Button className="md:col-span-5 md:w-fit" type="submit" isLoading={isLoading}>
          Apply filters
        </Button>
      </form>

      {error ? <Text className="text-ui-fg-error">{error}</Text> : null}
      {isLoading && !changes.length ? <Text>Loading history…</Text> : null}

      <div className="overflow-x-auto">
        <Table>
          <Table.Header>
            <Table.Row>
              <Table.HeaderCell>When</Table.HeaderCell>
              <Table.HeaderCell>Province</Table.HeaderCell>
              <Table.HeaderCell>Tax Rate</Table.HeaderCell>
              <Table.HeaderCell>Before</Table.HeaderCell>
              <Table.HeaderCell>After</Table.HeaderCell>
              <Table.HeaderCell>Operator</Table.HeaderCell>
            </Table.Row>
          </Table.Header>
          <Table.Body>{changes.map(renderChangeRow)}</Table.Body>
        </Table>
      </div>

      {!isLoading && !changes.length && !error ? (
        <Text>No Tax Rate changes match these filters.</Text>
      ) : null}

      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          {count
            ? `${query.offset + 1}–${Math.min(query.offset + changes.length, count)} of ${count}`
            : "0 results"}
        </Text>
        <div className="flex gap-2">
          <Button
            size="small"
            variant="secondary"
            disabled={!canGoBack || isLoading}
            onClick={showPreviousPage}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={!canGoForward || isLoading}
            onClick={showNextPage}
          >
            Next
          </Button>
        </div>
      </div>
    </Container>
  );
}

function taxRateChangesUrl(query: TaxRateHistoryQuery): string {
  const params = new URLSearchParams({
    limit: String(PAGE_SIZE),
    offset: String(query.offset),
  });

  if (query.provinceCode) {
    params.set("province_code", query.provinceCode);
  }
  if (query.taxRegionId) {
    params.set("tax_region_id", query.taxRegionId);
  }
  if (query.actorId) {
    params.set("actor_id", query.actorId);
  }
  if (query.action) {
    params.set("action", query.action);
  }
  if (query.from) {
    params.set("from", localDayStartAsIso(query.from));
  }
  if (query.to) {
    params.set("to", localDayEndAsIso(query.to));
  }

  return `/admin/tax-rate-changes?${params.toString()}`;
}

function renderChangeRow(change: TaxRateChangeResponse): ReactNode {
  return (
    <Table.Row key={change.id}>
      <Table.Cell>{formatDate(change.occurred_at)}</Table.Cell>
      <Table.Cell>{change.province_code ?? change.country_code}</Table.Cell>
      <Table.Cell>
        <div>{change.tax_rate_name}</div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {change.tax_rate_id} · {change.action}
        </Text>
      </Table.Cell>
      <Table.Cell>{formatRate(change.before_rate)}</Table.Cell>
      <Table.Cell>{formatRate(change.after_rate)}</Table.Cell>
      <Table.Cell>
        <div>{change.actor_email ?? "System"}</div>
        <Text size="xsmall" className="text-ui-fg-subtle">
          {change.actor_id} · {change.actor_kind}
        </Text>
      </Table.Cell>
    </Table.Row>
  );
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRate(value: number | null): string {
  return value === null ? "—" : `${value}%`;
}

function localDayStartAsIso(value: string): string {
  return localDayAsIso(value, 0, 0, 0, 0);
}

function localDayEndAsIso(value: string): string {
  return localDayAsIso(value, 23, 59, 59, 999);
}

function localDayAsIso(
  value: string,
  hours: number,
  minutes: number,
  seconds: number,
  milliseconds: number,
): string {
  const year = Number(value.slice(0, 4));
  const monthIndex = Number(value.slice(5, 7)) - 1;
  const day = Number(value.slice(8, 10));
  return new Date(year, monthIndex, day, hours, minutes, seconds, milliseconds).toISOString();
}

export default TaxRateHistoryPage;
