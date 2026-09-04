import type { Constraint, Guest, RSVP, Table } from './types'
import { ROOM_ORIGIN, ft } from './geometry'

function g(
  id: string,
  name: string,
  group: string,
  extra: { dietary?: string[]; rsvp?: RSVP; notes?: string } = {},
): Guest {
  return {
    id,
    name,
    group,
    dietary: extra.dietary ?? [],
    rsvp: extra.rsvp ?? 'yes',
    notes: extra.notes,
  }
}

const BRIDE = "Bride's family"
const GROOM = "Groom's family"
const PARTY = 'Bridal party'
const COLLEGE = 'College friends'
const WORK = 'Work friends'
const CHILDHOOD = 'Childhood friends'
const NEIGHBORS = 'Neighbors'
const KIDS = 'Kids'

export const SAMPLE_GUESTS: Guest[] = [
  // Bride's family — the Rossis
  g('g-rosa', 'Grandma Rosa Rossi', BRIDE, { notes: 'Cannot abide loud speakers' }),
  g('g-ezio', 'Grandpa Ezio Rossi', BRIDE),
  g('g-marta', 'Aunt Marta Rossi', BRIDE, { notes: 'Recently divorced from Dario' }),
  g('g-dario', 'Uncle Dario Rossi', BRIDE, { notes: 'Recently divorced from Marta' }),
  g('g-bianca', 'Aunt Bianca Rossi', BRIDE, { notes: 'Looks after Grandma Rosa' }),
  g('g-franco', 'Uncle Franco Rossi', BRIDE),
  g('g-lucia', 'Cousin Lucia Rossi', BRIDE),
  g('g-matteo', 'Cousin Matteo Rossi', BRIDE),
  g('g-elena', 'Cousin Elena Rossi', BRIDE),
  g('g-sofia', 'Sofia Rossi', BRIDE, { notes: 'Mother of the bride' }),
  g('g-marco', 'Marco Rossi', BRIDE, { notes: 'Father of the bride' }),
  g('g-paolo', 'Cousin Paolo Rossi', BRIDE, { rsvp: 'no' }),
  // Groom's family — the Okafors
  g('g-adaeze', 'Grandma Adaeze Okafor', GROOM),
  g('g-ngozi', 'Ngozi Okafor', GROOM, { notes: 'Mother of the groom' }),
  g('g-chidi', 'Chidi Okafor', GROOM, { notes: 'Father of the groom' }),
  g('g-amara', 'Aunt Amara Okafor', GROOM),
  g('g-emeka', 'Uncle Emeka Okafor', GROOM),
  g('g-ifeoma', 'Aunt Ifeoma Okafor', GROOM, { dietary: ['vegetarian'] }),
  g('g-obi', 'Uncle Obi Okafor', GROOM),
  g('g-zik', 'Cousin Zik Okafor', GROOM),
  g('g-chiamaka', 'Cousin Chiamaka Okafor', GROOM),
  g('g-nnamdi', 'Cousin Nnamdi Okafor', GROOM),
  g('g-ike', 'Uncle Ike Okafor', GROOM, { notes: 'Will request the microphone' }),
  g('g-ada', 'Cousin Ada Okafor', GROOM),
  // Bridal party
  g('g-maya', 'Maya Chen', PARTY, { notes: 'Maid of honor; with Chris' }),
  g('g-chris', 'Chris Park', PARTY, { notes: "Maya's partner" }),
  g('g-tunde', 'Tunde Bakare', PARTY, { notes: 'First on the dance floor' }),
  g('g-priya', 'Priya Sharma', PARTY, { dietary: ['vegetarian'] }),
  g('g-jordan', 'Jordan Banks', PARTY, { notes: 'Ex of Sam Whitfield' }),
  g('g-lena', 'Lena Kowalski', PARTY, { dietary: ['gluten-free'] }),
  g('g-dev', 'Dev Patel', PARTY),
  g('g-rosie', 'Rosie Alvarez', PARTY),
  // College friends
  g('g-sam', 'Sam Whitfield', COLLEGE, { notes: 'Ex of Jordan Banks' }),
  g('g-nick', 'Nick Papadopoulos', COLLEGE),
  g('g-harper', 'Harper Lane', COLLEGE, { dietary: ['vegan'] }),
  g('g-gabe', 'Gabe Ortiz', COLLEGE),
  g('g-yuki', 'Yuki Tanaka', COLLEGE, { dietary: ['vegetarian'] }),
  g('g-fran', 'Fran Delgado', COLLEGE),
  g('g-omar', 'Omar Haddad', COLLEGE, { dietary: ['halal'] }),
  g('g-jess', 'Jess Nguyen', COLLEGE, { notes: "Toby's partner, Poppy's mom" }),
  g('g-toby', 'Toby Reed', COLLEGE, { notes: "Jess's partner" }),
  g('g-kofi', 'Kofi Mensah', COLLEGE),
  g('g-isla', 'Isla MacLeod', COLLEGE, { rsvp: 'pending' }),
  g('g-bea', 'Bea Romano', COLLEGE),
  // Work friends
  g('g-diane', 'Diane Foster', WORK, { dietary: ['shellfish allergy'], notes: 'The boss — seat wisely' }),
  g('g-raj', 'Raj Iyer', WORK, { dietary: ['gluten-free'] }),
  g('g-carmen', 'Carmen Silva', WORK, { notes: "Milo's mom" }),
  g('g-pete', 'Pete Sorensen', WORK),
  g('g-annika', 'Annika Berg', WORK, { rsvp: 'no' }),
  g('g-leo', 'Leo Martins', WORK),
  g('g-grace', 'Grace Liu', WORK),
  g('g-hank', 'Hank Dawson', WORK, { rsvp: 'pending' }),
  // Childhood friends
  g('g-charlie', 'Charlie Dunn', CHILDHOOD, { notes: "Teddy's dad" }),
  g('g-effie', 'Effie Brooks', CHILDHOOD),
  g('g-miles', 'Miles Turner', CHILDHOOD),
  g('g-nora', 'Nora Flynn', CHILDHOOD),
  g('g-gus', 'Gus Weaver', CHILDHOOD),
  g('g-tilly', 'Tilly Marsh', CHILDHOOD),
  g('g-ray', 'Ray Suzuki', CHILDHOOD),
  g('g-wren', 'Wren Bailey', CHILDHOOD),
  // Neighbors
  g('g-rich', 'Rich Henderson', NEIGHBORS, { notes: 'Fence dispute with the Novaks' }),
  g('g-joan', 'Joan Henderson', NEIGHBORS),
  g('g-petra', 'Petra Novak', NEIGHBORS, { notes: 'Fence dispute with the Hendersons' }),
  g('g-karel', 'Karel Novak', NEIGHBORS),
  g('g-dot', 'Dot Pemberton', NEIGHBORS, { notes: 'Likes to see everyone arrive' }),
  g('g-stan', 'Stan Pemberton', NEIGHBORS),
  g('g-june', 'June Ellery', NEIGHBORS, { dietary: ['vegetarian'] }),
  g('g-walt', 'Walt Ellery', NEIGHBORS, { rsvp: 'pending' }),
  // Kids
  g('g-poppy', 'Poppy Nguyen-Reed', KIDS, { dietary: ['nut allergy'], notes: 'Jess & Toby’s daughter' }),
  g('g-milo', 'Milo Silva', KIDS, { notes: "Carmen's son" }),
  g('g-zara', 'Zara Okafor', KIDS, { notes: "Travels with Aunt Amara" }),
  g('g-teddy', 'Teddy Dunn', KIDS, { notes: "Charlie's son" }),
]

/** Table centers are given in feet from the room's top-left corner, the same
 *  way the venue's amenities are — this layout is a real floor plan for the
 *  default room, with the dance floor and band down its right-hand side. */
function t(id: string, name: string, shape: Table['shape'], seats: number, xFt: number, yFt: number): Table {
  return { id, name, shape, seats, x: ROOM_ORIGIN.x + ft(xFt), y: ROOM_ORIGIN.y + ft(yFt), rotation: 0 }
}

const SAMPLE_TABLES: Table[] = [
  t('t1', 'Table 1', 'round', 8, 7, 12),
  t('t2', 'Table 2', 'round', 8, 17.5, 12),
  t('t3', 'Table 3', 'round', 8, 28, 12),
  t('t4', 'Table 4', 'round', 8, 38.5, 12),
  t('t5', 'Table 5', 'round', 8, 7, 23),
  t('t6', 'Table 6', 'round', 8, 17.5, 23),
  t('t7', 'Table 7', 'round', 8, 28, 23),
  t('t8', 'Table 8', 'round', 8, 38.5, 23),
  t('t9', 'Table 9', 'rect', 10, 20, 38),
  t('t10', 'Table 10', 'rect', 10, 40, 38),
]

export const SAMPLE_CONSTRAINTS: Constraint[] = [
  { id: 'c1', type: 'apart', a: 'g-marta', b: 'g-dario', note: 'Recently divorced' },
  { id: 'c2', type: 'apart', a: 'g-jordan', b: 'g-sam', note: 'Exes — it did not end well' },
  { id: 'c3', type: 'apart', a: 'g-rich', b: 'g-petra', note: 'The fence dispute' },
  { id: 'c4', type: 'together', a: 'g-rosa', b: 'g-bianca', note: 'Bianca looks after her' },
  { id: 'c5', type: 'together', a: 'g-maya', b: 'g-chris', note: 'Couple' },
  { id: 'c6', type: 'together', a: 'g-jess', b: 'g-toby', note: 'Couple' },
  { id: 'c7', type: 'together', a: 'g-jess', b: 'g-poppy', note: 'Kid with parent' },
  { id: 'c8', type: 'together', a: 'g-carmen', b: 'g-milo', note: 'Kid with parent' },
  { id: 'c9', type: 'together', a: 'g-charlie', b: 'g-teddy', note: 'Kid with parent' },
  { id: 'c10', type: 'together', a: 'g-amara', b: 'g-zara', note: 'Zara travels with Amara' },
  { id: 'c11', type: 'zone', guestId: 'g-rosa', zone: 'band', preference: 'far', note: 'Hates loud speakers' },
  { id: 'c12', type: 'zone', guestId: 'g-ezio', zone: 'band', preference: 'far', note: 'Keeps Rosa company' },
  { id: 'c13', type: 'zone', guestId: 'g-priya', zone: 'dance_floor', preference: 'near' },
  { id: 'c14', type: 'zone', guestId: 'g-tunde', zone: 'dance_floor', preference: 'near' },
  { id: 'c15', type: 'zone', guestId: 'g-jordan', zone: 'dance_floor', preference: 'near' },
  { id: 'c16', type: 'zone', guestId: 'g-dot', zone: 'entrance', preference: 'near', note: 'Likes to see everyone arrive' },
  { id: 'c17', type: 'zone', guestId: 'g-diane', zone: 'dance_floor', preference: 'far', note: 'Prefers conversation' },
]

export const SAMPLE = {
  guests: SAMPLE_GUESTS,
  tables: SAMPLE_TABLES,
  constraints: SAMPLE_CONSTRAINTS,
}
