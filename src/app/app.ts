import { AfterViewInit, ChangeDetectionStrategy, Component } from '@angular/core';
import { startSim } from './sim/sim';

/**
 * Root component: renders the simulator's DOM (3D view, panels, HUD, menu) and boots the simulation once it exists.
 * The simulation drives its canvases and menu directly, outside Angular change detection.
 */
@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements AfterViewInit {
  ngAfterViewInit(): void {
    startSim();
  }

  onContinuePortrait(): void {
    document.body.classList.add('rotate-ok');
  }
}
