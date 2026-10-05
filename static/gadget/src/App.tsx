import { useEffect, useState } from 'react';
import { view } from '@forge/bridge';
import Spinner from '@atlaskit/spinner';
import GadgetView from './components/GadgetView';
import GadgetEditConfig from './components/GadgetEditConfig';

export default function App() {
  const [loading, setLoading] = useState(true);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    view.getContext().then(ctx => {
      const entryPoint = (ctx as any)?.extension?.entryPoint;
      setIsEditMode(entryPoint === 'edit');
      setLoading(false);
    }).catch(err => {
      console.warn('Could not read Forge context (likely local dev mode):', err);
      const urlParams = new URLSearchParams(window.location.search);
      setIsEditMode(urlParams.get('mode') === 'edit');
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '160px' }}>
        <Spinner size="medium" />
      </div>
    );
  }

  return isEditMode ? <GadgetEditConfig /> : <GadgetView />;
}
