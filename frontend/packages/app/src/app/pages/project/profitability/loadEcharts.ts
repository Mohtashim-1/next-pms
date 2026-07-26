/**
 * Load Apache ECharts from CDN once (same approach as the Desk dashboard).
 */
let echartsPromise: Promise<typeof window.echarts> | null = null;

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    echarts?: any;
  }
}

export function loadEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsPromise) return echartsPromise;
  echartsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.min.js";
    script.async = true;
    script.onload = () => {
      if (window.echarts) resolve(window.echarts);
      else reject(new Error("ECharts failed to load"));
    };
    script.onerror = () => reject(new Error("ECharts CDN unavailable"));
    document.head.appendChild(script);
  });
  return echartsPromise;
}
