const productionAppBaseUrl = "https://ahlamy.site";
const productionDashboardBaseUrl = "https://ahlamy-dashboard.vercel.app";
const developmentAppBaseUrl = "http://localhost:3000";
const developmentDashboardBaseUrl = "http://localhost:5173";
const localFrontendOrigins = ["http://localhost:3000", "http://localhost:3001"];

const trimTrailingSlash = (value: string) => value.replace(/\/$/, "");

export const isProduction = process.env.NODE_ENV === "production";

export const appBaseUrl = trimTrailingSlash(
  process.env.APP_BASE_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (isProduction ? productionAppBaseUrl : developmentAppBaseUrl),
);

export const dashboardBaseUrl = trimTrailingSlash(
  process.env.DASHBOARD_BASE_URL ||
    (isProduction ? productionDashboardBaseUrl : developmentDashboardBaseUrl),
);

export function getDefaultCorsOrigins() {
  const origins = isProduction
    ? [
        appBaseUrl,
        dashboardBaseUrl,
        "https://ahlamy.site",
        "https://www.ahlamy.site",
        "https://ahlamy.nodeteam.site",
        ...localFrontendOrigins,
      ]
    : [appBaseUrl, dashboardBaseUrl, "http://localhost:5174", ...localFrontendOrigins];

  return Array.from(new Set(origins.map(trimTrailingSlash)));
}

export function getDefaultCorsOriginPatterns() {
  return isProduction ? [/^https:\/\/([a-z0-9-]+\.)?ahlamy\.site$/] : [];
}
