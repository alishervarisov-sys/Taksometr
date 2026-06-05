import React, { useEffect, useState } from 'react';
import {
  Box, Typography, Card, CardContent, TextField, Button, Alert, Grid
} from '@mui/material';
import { doc, getDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';

interface TariffsProps {
  adminId: string;
}

const Tariffs: React.FC<TariffsProps> = ({ adminId }) => {
  const [baseCost, setBaseCost] = useState('5000');
  const [baseDistanceKm, setBaseDistanceKm] = useState('3');
  const [costPerKm, setCostPerKm] = useState('1500');
  const [freeWaitingMinutes, setFreeWaitingMinutes] = useState('5');
  const [costPerWaitingMinute, setCostPerWaitingMinute] = useState('500');
  
  // Fixed delivery types
  const [fixedTypes, setFixedTypes] = useState({
    coal: '0',           // Уголь
    gas15: '0',          // Газ до 15л
    gas30: '0',          // Газ до 30л
    gas30plus: '0',      // Газ более 30л
    errands: '0',        // Различные поручения
    heavyCargo: '0',     // Тяжелые грузы
  });
  
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadTariff();
  }, []);

  const loadTariff = async () => {
    try {
      const tariffDoc = await getDoc(doc(db, 'tariffs', 'default'));
      if (tariffDoc.exists()) {
        const data = tariffDoc.data();
        setBaseCost(String(data.baseCost ?? 5000));
        setBaseDistanceKm(String(data.baseDistanceKm ?? 3));
        setCostPerKm(String(data.costPerKm ?? 1500));
        setFreeWaitingMinutes(String(data.freeWaitingMinutes ?? 5));
        setCostPerWaitingMinute(String(data.costPerWaitingMinute ?? 500));
        
        // Load fixed types
        setFixedTypes({
          coal: String(data.fixedTypes?.coal ?? 0),
          gas15: String(data.fixedTypes?.gas15 ?? 0),
          gas30: String(data.fixedTypes?.gas30 ?? 0),
          gas30plus: String(data.fixedTypes?.gas30plus ?? 0),
          errands: String(data.fixedTypes?.errands ?? 0),
          heavyCargo: String(data.fixedTypes?.heavyCargo ?? 0),
        });
      }
    } catch (err) {
      console.error('Error loading tariff:', err);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess(false);
    setLoading(true);

    try {
      const updateTariffFn = httpsCallable(functions, 'updateTariff');
      await updateTariffFn({
        adminId,
        baseCost: Number(baseCost),
        baseDistanceKm: Number(baseDistanceKm),
        costPerKm: Number(costPerKm),
        freeWaitingMinutes: Number(freeWaitingMinutes),
        costPerWaitingMinute: Number(costPerWaitingMinute),
        fixedTypes: {
          coal: Number(fixedTypes.coal),
          gas15: Number(fixedTypes.gas15),
          gas30: Number(fixedTypes.gas30),
          gas30plus: Number(fixedTypes.gas30plus),
          errands: Number(fixedTypes.errands),
          heavyCargo: Number(fixedTypes.heavyCargo),
        },
      });
      setSuccess(true);
    } catch (err: any) {
      setError(err.message || 'Ошибка сохранения');
    } finally {
      setLoading(false);
    }
  };

  // Preview calculation: base covers baseDistanceKm, then costPerKm beyond
  const previewCost = (km: number) => {
    const base = Number(baseCost);
    const threshold = Number(baseDistanceKm);
    const perKm = Number(costPerKm);
    let cost = base;
    if (km > threshold) {
      cost += (km - threshold) * perKm;
    }
    return Math.max(base, Math.ceil(cost));
  };

  // Preview waiting cost
  const previewWaitingCost = (minutes: number) => {
    const freeMinutes = Number(freeWaitingMinutes);
    const perMinute = Number(costPerWaitingMinute);
    if (minutes <= freeMinutes) return 0;
    return (minutes - freeMinutes) * perMinute;
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, mb: 3 }}>Тарифы</Typography>

      <Grid container spacing={3}>
        <Grid item xs={12} md={6}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Настройка тарифа</Typography>

              <TextField
                fullWidth
                label="Базовая стоимость (сомони)"
                type="number"
                value={baseCost}
                onChange={(e) => setBaseCost(e.target.value)}
                margin="normal"
                helperText="Минимальная стоимость доставки"
              />

              <TextField
                fullWidth
                label="Базовое расстояние (км)"
                type="number"
                value={baseDistanceKm}
                onChange={(e) => setBaseDistanceKm(e.target.value)}
                margin="normal"
                helperText="До этого расстояния действует только базовая цена"
              />

              <TextField
                fullWidth
                label="Стоимость за километр (сомони)"
                type="number"
                value={costPerKm}
                onChange={(e) => setCostPerKm(e.target.value)}
                margin="normal"
                helperText="Берётся за каждый км сверх базового расстояния"
              />

              <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Тариф ожидания</Typography>

              <TextField
                fullWidth
                label="Бесплатное ожидание (минут)"
                type="number"
                value={freeWaitingMinutes}
                onChange={(e) => setFreeWaitingMinutes(e.target.value)}
                margin="normal"
                helperText="Количество бесплатных минут ожидания"
              />

              <TextField
                fullWidth
                label="Стоимость за минуту ожидания (сомони)"
                type="number"
                value={costPerWaitingMinute}
                onChange={(e) => setCostPerWaitingMinute(e.target.value)}
                margin="normal"
                helperText="Берётся за каждую минуту после бесплатного времени"
              />

              <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Фиксированные типы доставки</Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                Доставки без счётчика с фиксированной ценой
              </Typography>

              <TextField
                fullWidth
                label="Уголь (сомони)"
                type="number"
                value={fixedTypes.coal}
                onChange={(e) => setFixedTypes({ ...fixedTypes, coal: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за доставку угля"
              />

              <TextField
                fullWidth
                label="Газ до 15 литров (сомони)"
                type="number"
                value={fixedTypes.gas15}
                onChange={(e) => setFixedTypes({ ...fixedTypes, gas15: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за доставку газа до 15 литров"
              />

              <TextField
                fullWidth
                label="Газ до 30 литров (сомони)"
                type="number"
                value={fixedTypes.gas30}
                onChange={(e) => setFixedTypes({ ...fixedTypes, gas30: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за доставку газа до 30 литров"
              />

              <TextField
                fullWidth
                label="Газ более 30 литров (сомони)"
                type="number"
                value={fixedTypes.gas30plus}
                onChange={(e) => setFixedTypes({ ...fixedTypes, gas30plus: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за доставку газа более 30 литров"
              />

              <TextField
                fullWidth
                label="Различные поручения (сомони)"
                type="number"
                value={fixedTypes.errands}
                onChange={(e) => setFixedTypes({ ...fixedTypes, errands: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за различные поручения"
              />

              <TextField
                fullWidth
                label="Тяжелые грузы (сомони)"
                type="number"
                value={fixedTypes.heavyCargo}
                onChange={(e) => setFixedTypes({ ...fixedTypes, heavyCargo: e.target.value })}
                margin="normal"
                helperText="Фиксированная цена за тяжелые грузы"
              />

              {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
              {success && <Alert severity="success" sx={{ mt: 2 }}>Тариф обновлен</Alert>}

              <Button
                variant="contained"
                fullWidth
                onClick={handleSave}
                disabled={loading}
                sx={{ mt: 3 }}
              >
                Сохранить
              </Button>
            </CardContent>
          </Card>
        </Grid>

        <Grid item xs={12} md={6}>
          <Card>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2 }}>Предварительный расчет</Typography>

              <Typography variant="subtitle2" sx={{ mb: 1, color: 'text.secondary' }}>Расстояние:</Typography>
              <Box sx={{ '& > *': { mb: 1.5 } }}>
                <Typography>1 км: <strong>{previewCost(1).toLocaleString()} сомони</strong></Typography>
                <Typography>3 км: <strong>{previewCost(3).toLocaleString()} сомони</strong></Typography>
                <Typography>5 км: <strong>{previewCost(5).toLocaleString()} сомони</strong></Typography>
                <Typography>10 км: <strong>{previewCost(10).toLocaleString()} сомони</strong></Typography>
                <Typography>20 км: <strong>{previewCost(20).toLocaleString()} сомони</strong></Typography>
              </Box>

              <Typography variant="subtitle2" sx={{ mt: 2, mb: 1, color: 'text.secondary' }}>Ожидание:</Typography>
              <Box sx={{ '& > *': { mb: 1.5 } }}>
                <Typography>5 мин: <strong>{previewWaitingCost(5).toLocaleString()} сомони</strong> (бесплатно)</Typography>
                <Typography>10 мин: <strong>{previewWaitingCost(10).toLocaleString()} сомони</strong></Typography>
                <Typography>15 мин: <strong>{previewWaitingCost(15).toLocaleString()} сомони</strong></Typography>
                <Typography>30 мин: <strong>{previewWaitingCost(30).toLocaleString()} сомони</strong></Typography>
              </Box>

              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                Базовая цена ({Number(baseCost).toLocaleString()} сомони) действует до {baseDistanceKm} км.
                Далее +{Number(costPerKm).toLocaleString()} сомони за каждый км.
                Ожидание бесплатно первые {freeWaitingMinutes} мин, далее +{Number(costPerWaitingMinute).toLocaleString()} сомони/мин.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
};

export default Tariffs;
