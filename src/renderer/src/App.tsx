import { HashRouter as Router, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { AnalysisProvider } from './contexts/AnalysisContext'
import { Today } from './pages/Today'
import { DailyReport } from './pages/DailyReport'
import { QuarterlySummary } from './pages/QuarterlySummary'
import { YearlySummary } from './pages/YearlySummary'
import { Settings } from './pages/Settings'
import './styles/globals.css'

function App(): React.JSX.Element {
  return (
    <Router>
      <AnalysisProvider>
        <Layout>
          <Routes>
            <Route path="/" element={<Today />} />
            <Route path="/daily" element={<DailyReport />} />
            <Route path="/quarterly" element={<QuarterlySummary />} />
            <Route path="/yearly" element={<YearlySummary />} />
            <Route path="/settings" element={<Settings />} />
          </Routes>
        </Layout>
      </AnalysisProvider>
    </Router>
  )
}

export default App
