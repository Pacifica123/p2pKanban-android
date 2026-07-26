import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';

import { AppProviders } from './src/app/AppProviders';
import { RootNavigator } from './src/app/navigation/RootNavigator';

export default function App() {
  const colorScheme = useColorScheme();

  return (
    <AppProviders>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      <RootNavigator />
    </AppProviders>
  );
}
