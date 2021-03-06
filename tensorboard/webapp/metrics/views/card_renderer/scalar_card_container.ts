/* Copyright 2020 The TensorFlow Authors. All Rights Reserved.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
==============================================================================*/
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Input,
  OnInit,
  Output,
} from '@angular/core';
import {Store} from '@ngrx/store';
import {combineLatest, from, Observable, of} from 'rxjs';
import {
  combineLatestWith,
  debounceTime,
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  switchMap,
  takeWhile,
} from 'rxjs/operators';

import {State} from '../../../app_state';
import {
  getCardPinnedState,
  getCurrentRouteRunSelection,
  getExperimentIdForRunId,
  getExperimentIdToAliasMap,
  getIsGpuChartEnabled,
  getRun,
  getRunColorMap,
  getVisibleCardIdSet,
} from '../../../selectors';
import {DataLoadState} from '../../../types/data';
import {RunColorScale} from '../../../types/ui';
import {classicSmoothing} from '../../../widgets/line_chart_v2/data_transformer';
import {ScaleType} from '../../../widgets/line_chart_v2/types';
import {PluginType, ScalarStepDatum} from '../../data_source';
import {
  getCardLoadState,
  getCardMetadata,
  getCardTimeSeries,
  getMetricsIgnoreOutliers,
  getMetricsScalarSmoothing,
  getMetricsTooltipSort,
  getMetricsXAxisType,
  RunToSeries,
} from '../../store';
import {CardId, CardMetadata, XAxisType} from '../../types';
import {CardRenderer} from '../metrics_view_types';
import {getTagDisplayName} from '../utils';
import {LegacySeriesDataList} from './scalar_card_component';
import {
  ScalarCardDataSeries,
  ScalarCardPoint,
  ScalarCardSeriesMetadataMap,
  SeriesType,
} from './scalar_card_types';
import {getDisplayNameForRun} from './utils';

type ScalarCardMetadata = CardMetadata & {
  plugin: PluginType.SCALARS;
};

function areSeriesDataListEqual(
  listA: LegacySeriesDataList,
  listB: LegacySeriesDataList
): boolean {
  if (listA.length !== listB.length) {
    return false;
  }
  return listA.every((listAVal, index) => {
    const listBVal = listB[index];
    const listAPoints = listAVal.points;
    const listBPoints = listBVal.points;
    return (
      listAVal.seriesId === listBVal.seriesId &&
      listAVal.metadata.displayName === listBVal.metadata.displayName &&
      listAVal.visible === listBVal.visible &&
      listAPoints.length === listBPoints.length &&
      listAPoints.every((listAPoint, index) => {
        const listBPoint = listBPoints[index];
        return listAPoint.x === listBPoint.x && listAPoint.y === listBPoint.y;
      })
    );
  });
}

interface PartialSeries {
  runId: string;
  points: ScalarCardPoint[];
}

function areSeriesEqual(
  listA: PartialSeries[],
  listB: PartialSeries[]
): boolean {
  if (listA.length !== listB.length) {
    return false;
  }
  return listA.every((listAVal, index) => {
    const listBVal = listB[index];
    const listAPoints = listAVal.points;
    const listBPoints = listBVal.points;
    return (
      listAVal.runId === listBVal.runId &&
      listAPoints.length === listBPoints.length &&
      listAPoints.every((listAPoint, index) => {
        const listBPoint = listBPoints[index];
        return listAPoint.x === listBPoint.x && listAPoint.y === listBPoint.y;
      })
    );
  });
}

@Component({
  selector: 'scalar-card',
  template: `
    <scalar-card-component
      [loadState]="loadState$ | async"
      [runColorScale]="runColorScale"
      [title]="title$ | async"
      [tag]="tag$ | async"
      [seriesDataList]="legacySeriesDataList$ | async"
      [tooltipSort]="tooltipSort$ | async"
      [ignoreOutliers]="ignoreOutliers$ | async"
      [xAxisType]="xAxisType$ | async"
      [newXScaleType]="newXScaleType$ | async"
      [scalarSmoothing]="scalarSmoothing$ | async"
      [showFullSize]="showFullSize"
      [isPinned]="isPinned$ | async"
      [dataSeries]="(gpuLineChartEnabled$ | async) ? (dataSeries$ | async) : []"
      [chartMetadataMap]="
        (gpuLineChartEnabled$ | async) ? (chartMetadataMap$ | async) : {}
      "
      [gpuLineChartEnabled]="gpuLineChartEnabled$ | async"
      [smoothingEnabled]="smoothingEnabled$ | async"
      [isCardVisible]="isCardVisible$ | async"
      [isEverVisible]="isEverVisible$ | async"
      (onFullSizeToggle)="onFullSizeToggle()"
      (onPinClicked)="pinStateChanged.emit($event)"
    ></scalar-card-component>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScalarCardContainer implements CardRenderer, OnInit {
  constructor(private readonly store: Store<State>) {}

  @Input() cardId!: CardId;
  @Input() groupName!: string | null;
  @Input() runColorScale!: RunColorScale;
  @Output() fullWidthChanged = new EventEmitter<boolean>();
  @Output() fullHeightChanged = new EventEmitter<boolean>();
  @Output() pinStateChanged = new EventEmitter<boolean>();

  loadState$?: Observable<DataLoadState>;
  title$?: Observable<string>;
  tag$?: Observable<string>;
  legacySeriesDataList$?: Observable<LegacySeriesDataList> = of([]);
  isPinned$?: Observable<boolean>;
  dataSeries$?: Observable<ScalarCardDataSeries[]>;
  chartMetadataMap$?: Observable<ScalarCardSeriesMetadataMap>;

  readonly isCardVisible$ = this.store.select(getVisibleCardIdSet).pipe(
    map((visibleSet) => {
      return visibleSet.has(this.cardId);
    }),
    distinctUntilChanged()
  );
  readonly isEverVisible$ = this.isCardVisible$.pipe(
    takeWhile((visible) => !visible, true)
  );

  readonly tooltipSort$ = this.store.select(getMetricsTooltipSort);
  readonly ignoreOutliers$ = this.store.select(getMetricsIgnoreOutliers);
  readonly xAxisType$ = this.store.select(getMetricsXAxisType);
  readonly newXScaleType$ = this.xAxisType$.pipe(
    map((xAxisType) => {
      switch (xAxisType) {
        case XAxisType.STEP:
        case XAxisType.RELATIVE:
          return ScaleType.LINEAR;
        case XAxisType.WALL_TIME:
          return ScaleType.TIME;
        default:
          const neverType = xAxisType as never;
          throw new Error(`Invalid xAxisType for line chart. ${neverType}`);
      }
    })
  );

  readonly scalarSmoothing$ = this.store.select(getMetricsScalarSmoothing);
  readonly gpuLineChartEnabled$ = this.store.select(getIsGpuChartEnabled);
  readonly smoothingEnabled$ = this.store
    .select(getMetricsScalarSmoothing)
    .pipe(map((smoothing) => smoothing > 0));

  showFullSize = false;

  private isScalarCardMetadata(
    cardMetadata: CardMetadata
  ): cardMetadata is ScalarCardMetadata {
    const {plugin} = cardMetadata;
    return plugin === PluginType.SCALARS;
  }

  onFullSizeToggle() {
    this.showFullSize = !this.showFullSize;
    this.fullWidthChanged.emit(this.showFullSize);
    this.fullHeightChanged.emit(this.showFullSize);
  }

  /**
   * Build observables once cardId is defined (after onInit).
   */
  ngOnInit() {
    const selectCardMetadata$ = this.store.select(getCardMetadata, this.cardId);
    const cardMetadata$ = selectCardMetadata$.pipe(
      filter((cardMetadata) => {
        return !!cardMetadata && this.isScalarCardMetadata(cardMetadata);
      }),
      map((cardMetadata) => {
        return cardMetadata as ScalarCardMetadata;
      })
    );

    const nonNullRunsToScalarSeries$ = this.store
      .select(getCardTimeSeries, this.cardId)
      .pipe(
        filter((runToSeries) => Boolean(runToSeries)),
        map((runToSeries) => runToSeries as RunToSeries<PluginType.SCALARS>),
        shareReplay(1)
      );

    const partialSeries$ = nonNullRunsToScalarSeries$.pipe(
      combineLatestWith(this.store.select(getMetricsXAxisType)),
      map(([runToSeries, xAxisType]) => {
        const runIds = Object.keys(runToSeries);
        const results = runIds.map((runId) => {
          return {
            runId,
            points: this.stepSeriesToLineSeries(runToSeries[runId], xAxisType),
          };
        });
        return results;
      }),
      distinctUntilChanged(areSeriesEqual)
    );

    this.legacySeriesDataList$ = partialSeries$.pipe(
      switchMap<PartialSeries[], Observable<LegacySeriesDataList>>(
        (runIdAndPoints) => {
          if (!runIdAndPoints.length) {
            return of([] as LegacySeriesDataList);
          }

          const dataList$ = runIdAndPoints.map((runIdAndPoint) => {
            return this.getRunDisplayName(runIdAndPoint.runId).pipe(
              map<string, LegacySeriesDataList[number]>((displayName) => {
                return {
                  seriesId: runIdAndPoint.runId,
                  points: runIdAndPoint.points,
                  metadata: {displayName},
                  visible: false,
                };
              })
            );
          });
          return combineLatest(dataList$);
        }
      ),
      combineLatestWith(this.store.select(getCurrentRouteRunSelection)),
      // When the `fetchRunsSucceeded` action fires, the run selection
      // map and the metadata change. To prevent quick fire of changes,
      // debounce by a microtask to emit only single change for the runs
      // store change.
      debounceTime(0),
      map(([result, runSelectionMap]) => {
        return result.map((seriesData) => {
          return {
            ...seriesData,
            visible: Boolean(
              runSelectionMap && runSelectionMap.get(seriesData.seriesId)
            ),
          };
        });
      }),
      startWith([] as LegacySeriesDataList),
      distinctUntilChanged(areSeriesDataListEqual)
    ) as Observable<LegacySeriesDataList>;

    function getSmoothedSeriesId(seriesId: string): string {
      return JSON.stringify(['smoothed', seriesId]);
    }

    this.dataSeries$ = partialSeries$.pipe(
      combineLatestWith(this.store.select(getMetricsXAxisType)),
      // Normalize time and, optionally, compute relative time.
      map(([partialSeries, xAxisType]) => {
        return partialSeries.map((partial) => {
          // Normalize data and convert wallTime in seconds to milliseconds.
          // TODO(stephanwlee): when the legacy line chart is removed, do the conversion
          // at the effects.
          let normalizedPoints = partial.points.map((point) => {
            const wallTime = point.wallTime * 1000;
            const x = xAxisType === XAxisType.STEP ? point.x : wallTime;

            return {...point, x, wallTime};
          });

          if (xAxisType === XAxisType.RELATIVE && normalizedPoints.length) {
            const firstPoint = normalizedPoints[0];
            normalizedPoints = normalizedPoints.map((point) => ({
              ...point,
              x: point.x - firstPoint.x,
            }));
          }

          return {runId: partial.runId, points: normalizedPoints};
        });
      }),
      // Smooth
      combineLatestWith(this.store.select(getMetricsScalarSmoothing)),
      switchMap<[PartialSeries[], number], Observable<ScalarCardDataSeries[]>>(
        ([runsData, smoothing]) => {
          const cleanedRunsData = runsData.map(({runId: seriesId, points}) => ({
            id: seriesId,
            points,
          }));
          if (smoothing <= 0) {
            return of(cleanedRunsData);
          }

          return from(classicSmoothing(cleanedRunsData, smoothing)).pipe(
            map((smoothedDataSeriesList) => {
              const smoothedList = cleanedRunsData.map((dataSeries, index) => {
                return {
                  id: getSmoothedSeriesId(dataSeries.id),
                  points: smoothedDataSeriesList[index].points.map(
                    ({y}, pointIndex) => {
                      return {...dataSeries.points[pointIndex], y};
                    }
                  ),
                };
              });
              return [...cleanedRunsData, ...smoothedList];
            })
          );
        }
      ),
      startWith([] as ScalarCardDataSeries[])
    );

    this.chartMetadataMap$ = nonNullRunsToScalarSeries$.pipe(
      switchMap<
        RunToSeries<PluginType.SCALARS>,
        Observable<Array<{runId: string; displayName: string}>>
      >((runToSeries) => {
        const runIds = Object.keys(runToSeries);
        if (!runIds.length) {
          return of([]);
        }

        return combineLatest(
          runIds.map((runId) => {
            return this.getRunDisplayName(runId).pipe(
              map((displayName) => {
                return {runId, displayName};
              })
            );
          })
        );
      }),
      combineLatestWith(
        this.store.select(getCurrentRouteRunSelection),
        this.store.select(getRunColorMap),
        this.store.select(getMetricsScalarSmoothing)
      ),
      // When the `fetchRunsSucceeded` action fires, the run selection
      // map and the metadata change. To prevent quick fire of changes,
      // debounce by a microtask to emit only single change for the runs
      // store change.
      debounceTime(0),
      map(([seriesAndDisplayNames, runSelectionMap, colorMap, smoothing]) => {
        const metadataMap: ScalarCardSeriesMetadataMap = {};
        const shouldSmooth = smoothing > 0;

        for (const {runId, displayName} of seriesAndDisplayNames) {
          metadataMap[runId] = {
            type: SeriesType.ORIGINAL,
            id: runId,
            displayName,
            visible: Boolean(runSelectionMap && runSelectionMap.get(runId)),
            color: colorMap[runId] ?? '#fff',
            aux: false,
            opacity: 1,
          };
        }

        if (!shouldSmooth) {
          return metadataMap;
        }

        for (const [id, metadata] of Object.entries(metadataMap)) {
          const smoothedSeriesId = getSmoothedSeriesId(id);
          metadataMap[smoothedSeriesId] = {
            ...metadata,
            id: smoothedSeriesId,
            type: SeriesType.DERIVED,
            aux: false,
            originalSeriesId: id,
          };

          metadata.aux = true;
          metadata.opacity = 0.25;
        }
        return metadataMap;
      }),
      startWith({} as ScalarCardSeriesMetadataMap)
    );

    this.loadState$ = this.store.select(getCardLoadState, this.cardId);

    this.tag$ = cardMetadata$.pipe(
      map((cardMetadata) => {
        return cardMetadata.tag;
      })
    );

    this.title$ = this.tag$.pipe(
      map((tag) => {
        return getTagDisplayName(tag, this.groupName);
      })
    );

    this.isPinned$ = this.store.select(getCardPinnedState, this.cardId);
  }

  private getRunDisplayName(runId: string): Observable<string> {
    return combineLatest([
      this.store.select(getExperimentIdForRunId, {runId}),
      this.store.select(getExperimentIdToAliasMap),
      this.store.select(getRun, {runId}),
    ]).pipe(
      map(([experimentId, idToAlias, run]) => {
        return getDisplayNameForRun(
          runId,
          run,
          experimentId ? idToAlias[experimentId] : null
        );
      })
    );
  }

  private stepSeriesToLineSeries(
    stepSeries: ScalarStepDatum[],
    xAxisType: XAxisType
  ): ScalarCardPoint[] {
    const isStepBased = xAxisType === XAxisType.STEP;
    return stepSeries.map((stepDatum) => {
      return {
        ...stepDatum,
        x: isStepBased ? stepDatum.step : stepDatum.wallTime,
        y: stepDatum.value,
      };
    });
  }
}
