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
  Input,
  Output,
  EventEmitter,
} from '@angular/core';
import {stripMetricString} from '../../../util/metric_type';
import {AnnotationSorting, SortingOrder} from '../../../store/npmi_types';

@Component({
  selector: 'npmi-annotations-list-header-component',
  templateUrl: './header_component.ng.html',
  styleUrls: ['./header_component.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeaderComponent {
  @Input() numAnnotations!: number;
  @Input() selectedAnnotations!: string[];
  @Input() activeMetrics!: string[];
  @Input() sorting!: AnnotationSorting;
  @Output() onChangeSorting = new EventEmitter<string>();
  @Output() onAllAnnotationsToggled = new EventEmitter<boolean>();
  readonly SortingOrder = SortingOrder;

  stripMetric(metric: string): string {
    return stripMetricString(metric);
  }
}
