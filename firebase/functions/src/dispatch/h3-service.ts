import {cellToLatLng, gridDisk, latLngToCell} from "h3-js";
import {GeoPoint} from "./contracts";

export function toH3Cell(point: GeoPoint, resolution: number): string {
  return latLngToCell(point.latitude, point.longitude, resolution);
}

export function searchCells(pickup: GeoPoint, resolution: number, ring: number): string[] {
  return gridDisk(toH3Cell(pickup, resolution), ring);
}

export function cellCenter(cell: string): GeoPoint {
  const [latitude, longitude] = cellToLatLng(cell);
  return {latitude, longitude};
}

/** Exact geographic check after H3's deliberately coarse candidate lookup. */
export function distanceMeters(from: GeoPoint, to: GeoPoint): number {
  const radius = 6_371_000;
  const radians = Math.PI / 180;
  const dLat = (to.latitude - from.latitude) * radians;
  const dLng = (to.longitude - from.longitude) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(from.latitude * radians) *
    Math.cos(to.latitude * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
