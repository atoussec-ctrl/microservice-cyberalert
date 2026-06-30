/** Standardized error envelope returned by every failing HTTP request. */
export interface ApiErrorResponse {
  statusCode: number;
  /** Short, machine-friendly error label (e.g. "Not Found"). */
  error: string;
  /** Human-readable message(s). Arrays come from validation failures. */
  message: string | string[];
  /** ISO-8601 timestamp of when the error was produced. */
  timestamp: string;
  /** Request path that produced the error. */
  path: string;
}
