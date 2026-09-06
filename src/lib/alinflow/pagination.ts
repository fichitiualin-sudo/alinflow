// Use the returned count, not a requested page size: the server may cap pages.
export async function readAllRows<T = any>(
  query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<{ data: T[]; error: any }> {
  const rows: T[] = [];
  for (;;) {
    const result = await query(rows.length, rows.length + 499);
    if (result.error) return { data: [], error: result.error };
    if (!result.data?.length) return { data: rows, error: null };
    rows.push(...result.data);
  }
}
