import {
  CrossLinesModule,
  LegendModule,
  LineSeriesModule,
  ModuleRegistry,
  NumberAxisModule,
  TimeAxisModule,
} from 'ag-charts-community';

// Only what the runway chart draws, to keep the download small.
ModuleRegistry.registerModules([
  LineSeriesModule,
  TimeAxisModule,
  NumberAxisModule,
  LegendModule,
  CrossLinesModule,
]);
