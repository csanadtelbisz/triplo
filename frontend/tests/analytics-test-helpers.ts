import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export async function groupAnalyticsBy(page: Page, group: 'modes' | 'trips' | 'countries') {
  const button = page.locator('[data-analytics-grouping]');
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await button.getAttribute('data-analytics-grouping') === group) return;
    await button.click();
  }
  await expect(button).toHaveAttribute('data-analytics-grouping', group);
}
