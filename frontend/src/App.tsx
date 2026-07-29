import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { auth, functions } from './firebase'
import Play from './pages/Play'
import InstructorDashboard from './pages/InstructorDashboard'
import Configure from './pages/Configure'
import Reports from './pages/Reports'
import { configSections } from './configSections'
import { SettingsPage } from '@mygames/game-ui'

// The five routes every game in the fleet has. Keep the paths — the classroom app, the
// launcher and the instructor's bookmarks all assume /dashboard, /configure, /reports
// and /settings, and renaming one breaks a link nothing in this repo can see.

/** SINGLE undifferentiated MATCHING role. Seat roles are assigned late. */
const roleLabels: Record<string, string> = { player: 'Player' }

const infoLinks = [
  { roleKey: 'player', links: [{ key: 'player_sheet_url', label: 'Game instructions' }] },
]

/**
 * Instructor-editable settings.
 *
 * ⚠ EVERY KEY HERE MUST ALSO EXIST IN `configFields` IN functions/src/gameDefinition.ts,
 * and adding one means redeploying BOTH getGameConfig AND updateGameConfig — the
 * recognised-field list is baked into the deployed bundle, and the symptom of
 * forgetting is "No recognised fields to update" on code that is entirely correct.
 *
 * `kind` is limited to 'string' | 'positiveInt' | 'url'. There is NO decimal kind, so
 * probabilities and rates are strings, parsed server-side in round/settings.ts.
 */

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"          element={<Play />} />
        <Route path="/dashboard" element={<InstructorDashboard />} />
        <Route path="/configure" element={<Configure />} />
        <Route path="/reports"   element={<Reports />} />
        <Route path="/settings"  element={
          <SettingsPage
            title="Settings — Information Sharing"
            functions={functions}
            auth={auth}
            roleLabels={roleLabels}
            roleInfoLinks={infoLinks}
            configSections={configSections}
          />
        } />
      </Routes>
    </BrowserRouter>
  )
}
