import { SocketProvider } from './context/SocketContext';
import TrackingPage from './pages/TrackingPage';

export default function App() {
  return (
    <SocketProvider>
      <TrackingPage />
    </SocketProvider>
  );
}
