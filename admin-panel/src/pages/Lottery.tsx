import React, { useState, useEffect } from 'react';
import {
  Box,
  Card,
  CardContent,
  Typography,
  Button,
  Grid,
  LinearProgress,
  Chip,
  Avatar,
  Paper,
  Fade,
  Zoom,
} from '@mui/material';
import {
  EmojiEvents as TrophyIcon,
  Person as PersonIcon,
  PlayArrow as PlayIcon,
  Stop as StopIcon,
} from '@mui/icons-material';
import { collection, getDocs, query, where, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

interface Player {
  id: string;
  name: string;
  phone: string;
  ticketNumber: string;
}

interface Prize {
  id: string;
  name: string;
  imageUrl: string;
  order: number;
}

interface LotteryDrawing {
  lotteryId: string;
  soldTickets: number;
  totalTickets: number;
  prizes: Prize[];
  winners: number;
}

interface LotteryProps {
  adminId: string;
}

type DrawStep = 'idle' | 'selecting-player' | 'player-selected' | 'selecting-prize' | 'prize-awarded';

const Lottery: React.FC<LotteryProps> = ({ adminId }) => {
  const [lottery, setLottery] = useState<LotteryDrawing | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [availablePrizes, setAvailablePrizes] = useState<Prize[]>([]);
  const [currentPrizeIndex, setCurrentPrizeIndex] = useState(0);
  
  const [drawStep, setDrawStep] = useState<DrawStep>('idle');
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [selectedPrize, setSelectedPrize] = useState<Prize | null>(null);
  const [animatingPlayer, setAnimatingPlayer] = useState<Player | null>(null);
  const [animatingPrize, setAnimatingPrize] = useState<Prize | null>(null);
  
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLotteryData();
  }, []);

  const loadLotteryData = async () => {
    try {
      setLoading(true);
      
      // Load active lottery
      const lotteriesQuery = query(
        collection(db, 'lotteries'),
        where('status', '==', 'active')
      );
      const lotteriesSnapshot = await getDocs(lotteriesQuery);
      
      if (lotteriesSnapshot.empty) {
        console.log('No active lottery found');
        setLoading(false);
        return;
      }

      const lotteryDoc = lotteriesSnapshot.docs[0];
      const lotteryData = lotteryDoc.data();
      
      // Load prizes
      const prizesSnapshot = await getDocs(collection(db, `lotteries/${lotteryDoc.id}/prizes`));
      const prizesData = prizesSnapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      } as Prize)).sort((a, b) => a.order - b.order);

      // Load players (tickets)
      const ticketsSnapshot = await getDocs(collection(db, `lotteries/${lotteryDoc.id}/tickets`));
      const playersData = ticketsSnapshot.docs
        .filter(doc => !doc.data().won)
        .map(doc => ({
          id: doc.id,
          name: doc.data().playerName || 'Игрок',
          phone: doc.data().playerPhone || '',
          ticketNumber: doc.data().ticketNumber || doc.id,
        } as Player));

      // Load winners to determine current prize
      const winnersSnapshot = await getDocs(collection(db, `lotteries/${lotteryDoc.id}/winners`));
      const winnersCount = winnersSnapshot.size;

      setLottery({
        lotteryId: lotteryDoc.id,
        soldTickets: lotteryData.soldTickets || 0,
        totalTickets: lotteryData.totalTickets || 0,
        prizes: prizesData,
        winners: winnersCount,
      });
      
      setPlayers(playersData);
      setAvailablePrizes(prizesData);
      setCurrentPrizeIndex(winnersCount);
      
      setLoading(false);
    } catch (error) {
      console.error('Error loading lottery data:', error);
      setLoading(false);
    }
  };

  const startPlayerSelection = () => {
    if (players.length === 0) return;
    
    setDrawStep('selecting-player');
    setSelectedPlayer(null);
    
    // Animate random player selection
    let counter = 0;
    const maxIterations = 30;
    const interval = setInterval(() => {
      const randomPlayer = players[Math.floor(Math.random() * players.length)];
      setAnimatingPlayer(randomPlayer);
      counter++;
      
      if (counter >= maxIterations) {
        clearInterval(interval);
        const finalPlayer = players[Math.floor(Math.random() * players.length)];
        setSelectedPlayer(finalPlayer);
        setAnimatingPlayer(null);
        setDrawStep('player-selected');
      }
    }, 100);
  };

  const startPrizeSelection = () => {
    if (availablePrizes.length === 0 || currentPrizeIndex >= availablePrizes.length) return;
    
    setDrawStep('selecting-prize');
    setSelectedPrize(null);
    
    // Animate random prize selection
    let counter = 0;
    const maxIterations = 30;
    const interval = setInterval(() => {
      const randomPrize = availablePrizes[Math.floor(Math.random() * availablePrizes.length)];
      setAnimatingPrize(randomPrize);
      counter++;
      
      if (counter >= maxIterations) {
        clearInterval(interval);
        const finalPrize = availablePrizes[currentPrizeIndex];
        setSelectedPrize(finalPrize);
        setAnimatingPrize(null);
        setDrawStep('prize-awarded');
      }
    }, 100);
  };

  const awardPrizeAndContinue = async () => {
    if (!selectedPlayer || !selectedPrize || !lottery) return;

    try {
      // Save winner to Firebase
      await updateDoc(doc(db, `lotteries/${lottery.lotteryId}/tickets`, selectedPlayer.id), {
        won: true,
        prizeId: selectedPrize.id,
        wonAt: new Date(),
      });

      // Add to winners collection
      await updateDoc(doc(db, 'lotteries', lottery.lotteryId), {
        winners: (lottery.winners || 0) + 1,
      });

      // Move to next prize
      setCurrentPrizeIndex(prev => prev + 1);
      setSelectedPlayer(null);
      setSelectedPrize(null);
      setDrawStep('idle');
      
      // Reload data
      await loadLotteryData();
    } catch (error) {
      console.error('Error awarding prize:', error);
    }
  };

  const stopLottery = async () => {
    if (!lottery) return;
    
    try {
      await updateDoc(doc(db, 'lotteries', lottery.lotteryId), {
        status: 'completed',
        completedAt: new Date(),
      });
      
      await loadLotteryData();
    } catch (error) {
      console.error('Error stopping lottery:', error);
    }
  };

  if (loading) {
    return (
      <Box sx={{ width: '100%', mt: 4 }}>
        <LinearProgress />
        <Typography align="center" sx={{ mt: 2 }}>
          Загрузка розыгрыша...
        </Typography>
      </Box>
    );
  }

  if (!lottery) {
    return (
      <Box sx={{ textAlign: 'center', mt: 8 }}>
        <TrophyIcon sx={{ fontSize: 80, color: 'grey.400', mb: 2 }} />
        <Typography variant="h5" color="text.secondary">
          Нет активного розыгрыша
        </Typography>
      </Box>
    );
  }

  const currentPrize = availablePrizes[currentPrizeIndex];
  const isLotteryComplete = currentPrizeIndex >= availablePrizes.length;

  return (
    <Box sx={{ maxWidth: 1400, mx: 'auto' }}>
      {/* Header */}
      <Card sx={{ mb: 3, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <CardContent>
          <Typography variant="h4" sx={{ color: 'white', fontWeight: 700, mb: 2 }}>
            🎉 Розыгрыш Призов
          </Typography>
          <Grid container spacing={2}>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                  Всего билетов
                </Typography>
                <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                  {lottery.totalTickets}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                  Продано билетов
                </Typography>
                <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                  {lottery.soldTickets}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                  Призов
                </Typography>
                <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                  {lottery.prizes.length}
                </Typography>
              </Box>
            </Grid>
            <Grid item xs={12} sm={3}>
              <Box>
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.8)' }}>
                  Победителей
                </Typography>
                <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                  {lottery.winners}
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </CardContent>
      </Card>

      {/* Control Section */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
            <Box>
              <Typography variant="h6" sx={{ fontWeight: 600 }}>
                Управление розыгрышем
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Статус: <Chip label="Идёт розыгрыш" color="success" size="small" sx={{ ml: 1 }} />
              </Typography>
            </Box>
            <Button
              variant="outlined"
              color="error"
              startIcon={<StopIcon />}
              onClick={stopLottery}
            >
              Остановить розыгрыш
            </Button>
          </Box>

          <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
            Прогресс: {currentPrizeIndex}/{lottery.prizes.length}
          </Typography>
          <LinearProgress
            variant="determinate"
            value={(currentPrizeIndex / lottery.prizes.length) * 100}
            sx={{ height: 8, borderRadius: 4 }}
          />
        </CardContent>
      </Card>

      {!isLotteryComplete ? (
        <Grid container spacing={3}>
          {/* Current Prize Display */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%', background: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)' }}>
              <CardContent>
                <Typography variant="h6" sx={{ color: 'white', fontWeight: 600, mb: 2 }}>
                  🏆 Текущий приз
                </Typography>
                {currentPrize && (
                  <Zoom in={true}>
                    <Box sx={{ textAlign: 'center' }}>
                      <Box
                        component="img"
                        src={currentPrize.imageUrl || '/placeholder-prize.png'}
                        alt={currentPrize.name}
                        sx={{
                          width: '100%',
                          maxWidth: 200,
                          height: 200,
                          objectFit: 'cover',
                          borderRadius: 3,
                          mb: 2,
                          border: '4px solid white',
                        }}
                      />
                      <Typography variant="h5" sx={{ color: 'white', fontWeight: 700 }}>
                        {currentPrize.name}
                      </Typography>
                    </Box>
                  </Zoom>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Player Selection */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  👤 Выбор игрока
                </Typography>
                
                <Paper
                  sx={{
                    p: 3,
                    textAlign: 'center',
                    minHeight: 200,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    bgcolor: drawStep === 'selecting-player' ? 'action.hover' : 'background.default',
                  }}
                >
                  {drawStep === 'selecting-player' && animatingPlayer && (
                    <Fade in={true}>
                      <Box>
                        <Avatar sx={{ width: 80, height: 80, mb: 2, mx: 'auto', bgcolor: 'primary.main' }}>
                          <PersonIcon sx={{ fontSize: 40 }} />
                        </Avatar>
                        <Typography variant="h6">{animatingPlayer.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Билет: {animatingPlayer.ticketNumber}
                        </Typography>
                      </Box>
                    </Fade>
                  )}
                  
                  {selectedPlayer && drawStep !== 'selecting-player' && (
                    <Zoom in={true}>
                      <Box>
                        <Avatar sx={{ width: 80, height: 80, mb: 2, mx: 'auto', bgcolor: 'success.main' }}>
                          <PersonIcon sx={{ fontSize: 40 }} />
                        </Avatar>
                        <Typography variant="h6">{selectedPlayer.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          Билет: {selectedPlayer.ticketNumber}
                        </Typography>
                        <Chip label="Выбран!" color="success" sx={{ mt: 1 }} />
                      </Box>
                    </Zoom>
                  )}
                  
                  {!selectedPlayer && drawStep === 'idle' && (
                    <Typography color="text.secondary">
                      Нажмите кнопку для выбора игрока
                    </Typography>
                  )}
                </Paper>

                <Button
                  fullWidth
                  variant="contained"
                  size="large"
                  startIcon={<PlayIcon />}
                  onClick={startPlayerSelection}
                  disabled={drawStep !== 'idle' || players.length === 0}
                  sx={{ mt: 2 }}
                >
                  {drawStep === 'selecting-player' ? 'Выбор...' : 'Выбрать игрока'}
                </Button>
              </CardContent>
            </Card>
          </Grid>

          {/* Prize Selection */}
          <Grid item xs={12} md={4}>
            <Card sx={{ height: '100%' }}>
              <CardContent>
                <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
                  🎁 Выбор приза
                </Typography>
                
                <Paper
                  sx={{
                    p: 3,
                    textAlign: 'center',
                    minHeight: 200,
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'center',
                    bgcolor: drawStep === 'selecting-prize' ? 'action.hover' : 'background.default',
                  }}
                >
                  {drawStep === 'selecting-prize' && animatingPrize && (
                    <Fade in={true}>
                      <Box>
                        <Box
                          component="img"
                          src={animatingPrize.imageUrl || '/placeholder-prize.png'}
                          alt={animatingPrize.name}
                          sx={{
                            width: 80,
                            height: 80,
                            objectFit: 'cover',
                            borderRadius: 2,
                            mb: 2,
                          }}
                        />
                        <Typography variant="h6">{animatingPrize.name}</Typography>
                      </Box>
                    </Fade>
                  )}
                  
                  {selectedPrize && drawStep !== 'selecting-prize' && (
                    <Zoom in={true}>
                      <Box>
                        <Box
                          component="img"
                          src={selectedPrize.imageUrl || '/placeholder-prize.png'}
                          alt={selectedPrize.name}
                          sx={{
                            width: 80,
                            height: 80,
                            objectFit: 'cover',
                            borderRadius: 2,
                            mb: 2,
                          }}
                        />
                        <Typography variant="h6">{selectedPrize.name}</Typography>
                        <Chip label="Выбран!" color="success" sx={{ mt: 1 }} />
                      </Box>
                    </Zoom>
                  )}
                  
                  {!selectedPrize && drawStep !== 'selecting-prize' && drawStep !== 'prize-awarded' && (
                    <Typography color="text.secondary">
                      Сначала выберите игрока
                    </Typography>
                  )}
                </Paper>

                {drawStep === 'player-selected' && (
                  <Button
                    fullWidth
                    variant="contained"
                    size="large"
                    startIcon={<PlayIcon />}
                    onClick={startPrizeSelection}
                    sx={{ mt: 2 }}
                  >
                    Выбрать приз
                  </Button>
                )}

                {drawStep === 'prize-awarded' && (
                  <Button
                    fullWidth
                    variant="contained"
                    color="success"
                    size="large"
                    onClick={awardPrizeAndContinue}
                    sx={{ mt: 2 }}
                  >
                    Следующий приз →
                  </Button>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      ) : (
        <Card>
          <CardContent sx={{ textAlign: 'center', py: 8 }}>
            <TrophyIcon sx={{ fontSize: 100, color: 'primary.main', mb: 3 }} />
            <Typography variant="h4" sx={{ fontWeight: 700, mb: 2 }}>
              🎉 Розыгрыш завершён!
            </Typography>
            <Typography variant="h6" color="text.secondary">
              Все призы разыграны. Поздравляем победителей!
            </Typography>
          </CardContent>
        </Card>
      )}

      {/* All Prizes List */}
      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" sx={{ fontWeight: 600, mb: 2 }}>
            🏆 Призы ({lottery.prizes.length})
          </Typography>
          <Grid container spacing={2}>
            {lottery.prizes.map((prize, index) => (
              <Grid item xs={6} sm={4} md={3} key={prize.id}>
                <Paper
                  sx={{
                    p: 2,
                    textAlign: 'center',
                    opacity: index < currentPrizeIndex ? 0.5 : 1,
                    border: index === currentPrizeIndex ? '2px solid' : 'none',
                    borderColor: 'primary.main',
                  }}
                >
                  <Box
                    component="img"
                    src={prize.imageUrl || '/placeholder-prize.png'}
                    alt={prize.name}
                    sx={{
                      width: '100%',
                      height: 100,
                      objectFit: 'cover',
                      borderRadius: 2,
                      mb: 1,
                    }}
                  />
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {prize.name}
                  </Typography>
                  {index < currentPrizeIndex && (
                    <Chip label="Разыгран" color="success" size="small" sx={{ mt: 1 }} />
                  )}
                  {index === currentPrizeIndex && (
                    <Chip label="Текущий" color="primary" size="small" sx={{ mt: 1 }} />
                  )}
                </Paper>
              </Grid>
            ))}
          </Grid>
        </CardContent>
      </Card>
    </Box>
  );
};

export default Lottery;
