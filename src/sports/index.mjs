// Виды спорта матч-центра. Первый в списке — вид по умолчанию.
import tennis from './tennis/index.mjs';

export const sports = [tennis];
export const defaultSport = sports[0];
export const sportById = (id) => sports.find((s) => s.id === id) || null;
