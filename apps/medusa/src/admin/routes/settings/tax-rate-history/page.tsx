import { defineRouteConfig } from "@medusajs/admin-sdk";
import { Button, Container, Heading, Input, Table, Text } from "@medusajs/ui";
import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";

type TaxRateChange = {
  id: string;
  action: "created" | "updated";
  tax_rate_id: string;
  country_code: string;
  province_code: string | null;
  tax_rate_name: string;
  tax_rate_code: string | null;
  before_rate: number | null;
  after_rate: number | null;
  actor_kind: "operator" | "system";
  actor_id: string;
  actor_email: string | null;
  occurred_at: string;
};

type Filters = {
  provinceCode: string;
  taxRegionId: string;
  actorId: string;
  action: "" | "created" | "updated";
  from: string;
  to: string;
  offset: number;
};

type TaxRateChangesResponse = {
  tax_rate_changes: TaxRateChange[];
  count: number;
  limit: number;
  offset: number;
};

const PAGE_SIZE = 50;
const EMPTY_FILTERS: Filters = {
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

const TaxRateHistoryPage = () => {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [changes, setChanges] = useState<TaxRateChange[]>([]);
  const [count, setCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChanges = useCallback(async (nextFilters: Filters) => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      limit: String(PAGE_SIZE),
      offset: String(nextFilters.offset),
    });

    const filterParams: Record<string, string> = {
      province_code: nextFilters.provinceCode,
      tax_region_id: nextFilters.taxRegionId,
      actor_id: nextFilters.actorId,
      action: nextFilters.action,
      from: nextFilters.from,
      to: nextFilters.to,
    };

    for (const [key, value] of Object.entries(filterParams)) {
      if (value) {
        params.set(key, value);
      }
    }

    try {
      const response = await fetch(`/admin/tax-rate-changes?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`The history request failed (${response.status}).`);
      }

      const body = (await response.json()) as TaxRateChangesResponse;
      setChanges(body.tax_rate_changes);
      setCount(body.count);
    } catch (requestError) {
      setError(
        requestError instanceof Error ? requestError.message : "The history request failed.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadChanges(EMPTY_FILTERS);
  }, [loadChanges]);

  const updateFilter = (key: keyof Omit<Filters, "offset">, value: string) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const submitFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextFilters = { ...filters, offset: 0 };
    setFilters(nextFilters);
    void loadChanges(nextFilters);
  };

  const canGoBack = filters.offset > 0;
  const canGoForward = filters.offset + changes.length < count;

  return (
    <Container className="flex flex-col gap-6 p-6">
      <div>
        <Heading level="h1">Tax Rate History</Heading>
        <Text size="small" className="text-ui-fg-subtle mt-1">
          Review every Tax Rate create and update recorded by the system.
        </Text>
      </div>

      <form className="grid grid-cols-1 gap-3 md:grid-cols-5" onSubmit={submitFilters}>
        <Input
          aria-label="Province"
          placeholder="Province (ES-M)"
          value={filters.provinceCode}
          onChange={(event) => updateFilter("provinceCode", event.target.value)}
        />
        <Input
          aria-label="Tax Region ID"
          placeholder="Tax Region ID"
          value={filters.taxRegionId}
          onChange={(event) => updateFilter("taxRegionId", event.target.value)}
        />
        <Input
          aria-label="Operator ID"
          placeholder="Operator ID"
          value={filters.actorId}
          onChange={(event) => updateFilter("actorId", event.target.value)}
        />
        <select
          aria-label="Action"
          className="bg-ui-bg-field border-ui-border-base text-ui-fg-base focus:border-ui-border-interactive rounded-md border px-3 py-2 text-sm"
          value={filters.action}
          onChange={(event) => updateFilter("action", event.target.value)}
        >
          <option value="">All actions</option>
          <option value="created">Created</option>
          <option value="updated">Updated</option>
        </select>
        <Input
          aria-label="From date"
          type="date"
          value={filters.from}
          onChange={(event) => updateFilter("from", event.target.value)}
        />
        <Input
          aria-label="To date"
          type="date"
          value={filters.to}
          onChange={(event) => updateFilter("to", event.target.value)}
        />
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
          <Table.Body>
            {changes.map((change) => (
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
                  <div>{change.actor_email ?? change.actor_id}</div>
                  <Text size="xsmall" className="text-ui-fg-subtle">
                    {change.actor_kind}
                  </Text>
                </Table.Cell>
              </Table.Row>
            ))}
          </Table.Body>
        </Table>
      </div>

      {!isLoading && !changes.length && !error ? (
        <Text>No Tax Rate changes match these filters.</Text>
      ) : null}

      <div className="flex items-center justify-between">
        <Text size="small" className="text-ui-fg-subtle">
          {count
            ? `${filters.offset + 1}–${Math.min(filters.offset + changes.length, count)} of ${count}`
            : "0 results"}
        </Text>
        <div className="flex gap-2">
          <Button
            size="small"
            variant="secondary"
            disabled={!canGoBack || isLoading}
            onClick={() => {
              const nextFilters = { ...filters, offset: Math.max(0, filters.offset - PAGE_SIZE) };
              setFilters(nextFilters);
              void loadChanges(nextFilters);
            }}
          >
            Previous
          </Button>
          <Button
            size="small"
            variant="secondary"
            disabled={!canGoForward || isLoading}
            onClick={() => {
              const nextFilters = { ...filters, offset: filters.offset + PAGE_SIZE };
              setFilters(nextFilters);
              void loadChanges(nextFilters);
            }}
          >
            Next
          </Button>
        </div>
      </div>
    </Container>
  );
};

export default TaxRateHistoryPage;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatRate(value: number | null) {
  return value === null ? "—" : `${value}%`;
}
