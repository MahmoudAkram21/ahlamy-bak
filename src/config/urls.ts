const productionAppBaseUrl = "https://ahlamy.nodeteam.site";
const developmentAppBaseUrl = "http://localhost:3000";
const developmentDashboardBaseUrl = "http://localhost:5173";

const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

export const isProduction = process.env.NODE_ENV === "production";

export const appBaseUrl = trimTrailingSlash(
  process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (isProduction ? productionAppBaseUrl : developmentAppBaseUrl),
);

export const dashboardBaseUrl = trimTrailingSlash(
  process.env.DASHBOARD_BASE_URL ||
    (isProduction ? productionAppBaseUrl : developmentDashboardBaseUrl),
);

export function getDefaultCorsOrigins() {
  const origins = isProduction
    ? [appBaseUrl, dashboardBaseUrl]
    : [appBaseUrl, dashboardBaseUrl, "http://localhost:5174"];

  return Array.from(new Set(origins.map(trimTrailingSlash)));
}
