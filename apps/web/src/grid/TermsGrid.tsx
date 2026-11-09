import { enableDevValidations } from 'ag-grid-community';
import { AllEnterpriseModule } from 'ag-grid-enterprise';
import { AgGridProvider, AgGridReact, type AgGridReactProps } from 'ag-grid-react';
import { termsGridTheme } from './theme';

if (import.meta.env.DEV) enableDevValidations();

const modules = [AllEnterpriseModule];
const licenseKey = import.meta.env.VITE_AG_GRID_LICENSE_KEY;

/**
 * Every grid in the app. Registers AG Grid Enterprise, applies the licence (without one the grid
 * still works and shows a watermark) and the Terms theme. The parent must give it a height,
 * unless `domLayout` is `autoHeight`.
 */
export function TermsGrid<TData>(props: AgGridReactProps<TData>) {
  return (
    <AgGridProvider modules={modules} {...(licenseKey ? { licenseKey } : {})}>
      <AgGridReact<TData> theme={termsGridTheme} {...props} />
    </AgGridProvider>
  );
}
