import { Toaster } from 'sonner';
import {BrowserRouter,Routes,Route} from 'react-router';
import DashBoard from './pages/DashBoard';
import NotFound from './pages/NotFound';
import Login from './pages/Login';
import ProtectedRoute from './components/ProtectedRoute';

function App() {

  return (
    <>
      <Toaster richColors position="top-right" />
      <BrowserRouter>
        <Routes>
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<DashBoard />} />
          </Route>

          <Route 
            path='*'
            element={<NotFound/>}
          />

          <Route
            path='/login'
            element={<Login/>}
          />
        </Routes>
      </BrowserRouter>
    </>
  )
}

export default App
