import { HitAreaEngine } from './hit-area-engine';

export class InteractionDebugOverlay {
  private container: HTMLDivElement;
  private spriteImg: HTMLImageElement;
  private hitAreaEngine: HitAreaEngine;
  private svg: SVGElement;
  private infoText: SVGTextElement | null = null;
  private infoBg: SVGRectElement | null = null;

  private isEnabled = false;

  private lastMouseX = 0;
  private lastMouseY = 0;
  private currentAreaId: string | null = null;
  private currentEvent: string | null = null;
  private currentRuleId: string | null = null;

  constructor(container: HTMLDivElement, spriteImg: HTMLImageElement, hitAreaEngine: HitAreaEngine) {
    this.container = container;
    this.spriteImg = spriteImg;
    this.hitAreaEngine = hitAreaEngine;

    // Create SVG element
    this.svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    this.svg.style.pointerEvents = 'none';
    this.svg.style.overflow = 'visible';
    this.svg.style.position = 'absolute';
    this.container.appendChild(this.svg);

    this.container.style.position = 'absolute';
    this.container.style.left = '0';
    this.container.style.top = '0';
    this.container.style.width = '100%';
    this.container.style.height = '100%';
    this.container.style.pointerEvents = 'none';
    this.container.style.zIndex = '999';
    this.container.style.display = 'none';
  }

  public setEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    if (!enabled) {
      this.container.style.display = 'none';
      this.clearSvg();
    } else {
      this.container.style.display = 'block';
      this.render();
    }
  }

  public updateEngine(hitAreaEngine: HitAreaEngine) {
    this.hitAreaEngine = hitAreaEngine;
    if (this.isEnabled) {
      this.render();
    }
  }

  public updatePointerInfo(clientX: number, clientY: number, areaId: string | null) {
    this.lastMouseX = clientX;
    this.lastMouseY = clientY;
    this.currentAreaId = areaId;
    if (this.isEnabled) {
      this.render();
    }
  }

  public updateEventInfo(event: string | null, ruleId: string | null) {
    this.currentEvent = event;
    this.currentRuleId = ruleId;
    if (this.isEnabled) {
      this.render();
    }
  }

  private clearSvg() {
    while (this.svg.firstChild) {
      this.svg.removeChild(this.svg.firstChild);
    }
    this.infoText = null;
    this.infoBg = null;
  }

  public render() {
    if (!this.isEnabled) return;

    this.clearSvg();

    const rect = this.spriteImg.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    if (w === 0 || h === 0) return;

    // Position SVG exactly over the sprite image
    const parentRect = this.container.getBoundingClientRect();
    const leftOffset = rect.left - parentRect.left;
    const topOffset = rect.top - parentRect.top;

    this.svg.setAttribute("width", w.toString());
    this.svg.setAttribute("height", h.toString());
    this.svg.style.left = `${leftOffset}px`;
    this.svg.style.top = `${topOffset}px`;

    const areas = this.hitAreaEngine.getHitAreas();
    const colors = ["#ff4757", "#2ed573", "#1e90ff", "#ffa502", "#9b59b6"];

    areas.forEach((area, index) => {
      const color = colors[index % colors.length];
      const isCurrent = this.currentAreaId === area.id;
      const fillOpacity = isCurrent ? "0.3" : "0.1";
      const strokeWidth = isCurrent ? "3" : "1.5";
      const strokeDash = isCurrent ? "none" : "4,4";

      let shapeEl: SVGElement | null = null;

      if (area.shape === "rect") {
        const rEl = document.createElementNS("http://www.w3.org/2000/svg", "rect");
        rEl.setAttribute("x", (area.x * w).toString());
        rEl.setAttribute("y", (area.y * h).toString());
        rEl.setAttribute("width", (area.width * w).toString());
        rEl.setAttribute("height", (area.height * h).toString());
        shapeEl = rEl;
      } else if (area.shape === "ellipse") {
        const eEl = document.createElementNS("http://www.w3.org/2000/svg", "ellipse");
        eEl.setAttribute("cx", (area.cx * w).toString());
        eEl.setAttribute("cy", (area.cy * h).toString());
        eEl.setAttribute("rx", (area.rx * w).toString());
        eEl.setAttribute("ry", (area.ry * h).toString());
        shapeEl = eEl;
      } else if (area.shape === "polygon") {
        const pEl = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
        const pointsStr = area.points.map(p => `${p[0] * w},${p[1] * h}`).join(" ");
        pEl.setAttribute("points", pointsStr);
        shapeEl = pEl;
      }

      if (shapeEl) {
        shapeEl.setAttribute("stroke", color);
        shapeEl.setAttribute("stroke-width", strokeWidth);
        shapeEl.setAttribute("stroke-dasharray", strokeDash);
        shapeEl.setAttribute("fill", color);
        shapeEl.setAttribute("fill-opacity", fillOpacity);
        this.svg.appendChild(shapeEl);

        // Add text label near center
        const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
        let lx = 0;
        let ly = 0;

        if (area.shape === "rect") {
          lx = (area.x + area.width / 2) * w;
          ly = (area.y + area.height / 2) * h;
        } else if (area.shape === "ellipse") {
          lx = area.cx * w;
          ly = area.cy * h;
        } else if (area.shape === "polygon") {
          const sum = area.points.reduce((s, p) => [s[0] + p[0], s[1] + p[1]], [0, 0]);
          lx = (sum[0] / area.points.length) * w;
          ly = (sum[1] / area.points.length) * h;
        }

        label.setAttribute("x", lx.toString());
        label.setAttribute("y", ly.toString());
        label.setAttribute("fill", color);
        label.setAttribute("font-size", "11px");
        label.setAttribute("font-weight", "bold");
        label.setAttribute("text-anchor", "middle");
        label.setAttribute("dominant-baseline", "middle");
        label.style.fontFamily = "sans-serif";
        label.style.pointerEvents = 'none';
        label.textContent = `${area.name || area.id} (${(area as any).interactionRole || 'touch'}) pri=${area.priority ?? 0}`;
        this.svg.appendChild(label);
      }
    });

    // Render debug text block in top-left
    const normCoords = this.hitAreaEngine.getNormalizedCoordinates(this.lastMouseX, this.lastMouseY, rect, "right");
    const nx = normCoords ? normCoords.x.toFixed(3) : "NaN";
    const ny = normCoords ? normCoords.y.toFixed(3) : "NaN";

    const lines = [
      `Normalized Coords: (${nx}, ${ny})`,
      `Client Coords: (${this.lastMouseX}, ${this.lastMouseY})`,
      `Hover Area: ${this.currentAreaId || "none"}`,
      `Last Event: ${this.currentEvent || "none"}`,
      `Matched Rule: ${this.currentRuleId || "none"}`
    ];

    const infoGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
    infoGroup.style.transform = "translate(10px, 10px)";
    this.svg.appendChild(infoGroup);

    this.infoBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    this.infoBg.setAttribute("fill", "black");
    this.infoBg.setAttribute("fill-opacity", "0.75");
    this.infoBg.setAttribute("rx", "4");
    this.infoBg.setAttribute("ry", "4");
    infoGroup.appendChild(this.infoBg);

    this.infoText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    this.infoText.setAttribute("fill", "#2ed573");
    this.infoText.setAttribute("font-size", "10px");
    this.infoText.style.fontFamily = "monospace";
    infoGroup.appendChild(this.infoText);

    lines.forEach((line, i) => {
      const tspan = document.createElementNS("http://www.w3.org/2000/svg", "tspan");
      tspan.setAttribute("x", "8");
      tspan.setAttribute("dy", i === 0 ? "12" : "14");
      tspan.textContent = line;
      this.infoText!.appendChild(tspan);
    });

    // Adjust background size to text
    const textBbox = this.infoText.getBBox();
    this.infoBg.setAttribute("width", (textBbox.width + 16).toString());
    this.infoBg.setAttribute("height", (textBbox.height + 12).toString());
  }
}
