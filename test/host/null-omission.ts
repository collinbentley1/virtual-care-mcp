export function omitNullObjectProperties(value: unknown): unknown {
	if (Array.isArray(value)) return value.map((entry: unknown) => omitNullObjectProperties(entry));
	if (typeof value !== "object" || value === null) return value;
	const entries: Array<[string, unknown]> = Object.entries(value);
	return Object.fromEntries(entries
		.filter(([, entry]) => entry !== null)
		.map(([key, entry]) => [key, omitNullObjectProperties(entry)]));
}
