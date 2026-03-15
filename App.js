import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  TextInput, Alert, ScrollView, Animated, StatusBar,
  Dimensions, Platform, Switch, Modal, KeyboardAvoidingView, Linking
} from 'react-native';
import * as Contacts from 'expo-contacts';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';

// ─── AdMob 설정 ───────────────────────────────────────
// 빌드 후 실제 ID로 교체: ca-app-pub-XXXXXXXXXXXXXXXX/XXXXXXXXXX
// 테스트 ID (빌드 전 개발용): ca-app-pub-3940256099942544/1033173712
let InterstitialAd = null;
let AdEventType = null;
try {
  const admob = require('react-native-google-mobile-ads');
  InterstitialAd = admob.InterstitialAd;
  AdEventType    = admob.AdEventType;
} catch (e) {
  // AdMob 패키지 미설치 시 더미로 동작 (Snack 환경)
}

const ADMOB_UNIT_ID = 'ca-app-pub-6224399845260801/7587909308';

const { width, height } = Dimensions.get('window');

const C = {
  bg:         '#0A0E1A',
  bgCard:     '#111827',
  bgCardAlt:  '#161D2E',
  navy:       '#1A2340',
  gold:       '#C9A84C',
  goldSoft:   '#C9A84C18',
  moonWhite:  '#EEE8DA',
  text:       '#DDD5C0',
  textMuted:  '#6B7280',
  red:        '#E05252',
  redSoft:    '#E0525218',
  green:      '#52C07A',
  greenSoft:  '#52C07A18',
  blue:       '#5B8DEF',
  border:     '#1F2D45',
  borderGold: '#C9A84C44',
};

const PRESET_HOURS = [
  { label: '3시간',   value: 3,          emoji: '🌙' },
  { label: '6시간',   value: 6,          emoji: '🌛' },
  { label: '8시간',   value: 8,          emoji: '⭐' },
  { label: '내일 아침', value: 'tomorrow7', emoji: '🌅' },
];

// ─── 유틸 ───────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, shouldPlaySound: true, shouldSetBadge: true,
  }),
});

const getRestoreTime = (sel, custom) => {
  if (sel === 'tomorrow7') {
    const t = new Date();
    t.setDate(t.getDate() + 1);
    t.setHours(7, 0, 0, 0);
    return t.getTime();
  }
  const h = custom ? parseInt(custom) : sel;
  if (!h || isNaN(h)) return null;
  return Date.now() + h * 3600000;
};

const getTimeRemaining = (restoreAt) => {
  const diff = restoreAt - Date.now();
  if (diff <= 0) return '해제 시간이 됐어요';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return h === 0 ? `${m}분 남았어요` : `${h}시간 ${m}분 남았어요`;
};

const formatDate = (ts) => {
  const d = new Date(ts);
  return `${d.getMonth()+1}/${d.getDate()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

// ─── 독립 컴포넌트들 (App 밖에 정의 → 키보드 버그 없음) ────

const StarBg = () => {
  const stars = useRef(
    Array.from({ length: 20 }, (_, i) => ({
      key: i,
      top: Math.random() * height * 0.45,
      left: Math.random() * width,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.35 + 0.08,
    }))
  ).current;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {stars.map(s => (
        <View key={s.key} style={{
          position: 'absolute', top: s.top, left: s.left,
          width: s.size, height: s.size, borderRadius: s.size,
          backgroundColor: C.moonWhite, opacity: s.opacity,
        }} />
      ))}
    </View>
  );
};

const TabBar = ({ tab, setTab }) => {
  const tabs = [
    { id: 'home',     label: '홈',   emoji: '🌙' },
    { id: 'add',      label: '보호', emoji: '🔒' },
    { id: 'schedule', label: '예약', emoji: '⏰' },
    { id: 'stats',    label: '기록', emoji: '📊' },
  ];
  return (
    <View style={st.tabBar}>
      {tabs.map(t => (
        <TouchableOpacity key={t.id} style={st.tabItem} onPress={() => setTab(t.id)}>
          <Text style={st.tabEmoji}>{t.emoji}</Text>
          <Text style={[st.tabLabel, tab === t.id && st.tabLabelActive]}>{t.label}</Text>
          {tab === t.id && <View style={st.tabDot} />}
        </TouchableOpacity>
      ))}
    </View>
  );
};

// 연락처 검색 피커 — 자체 검색 상태 관리
const ContactPicker = ({ contacts, loading, selected, onSelect }) => {
  const [q, setQ] = useState('');
  const filtered = q.trim() === ''
    ? contacts
    : contacts.filter(c =>
        c.name?.toLowerCase().includes(q.toLowerCase()) ||
        c.phoneNumbers?.[0]?.number?.includes(q)
      );
  return (
    <View style={{ flex: 1 }}>
      <TextInput
        style={st.searchInput}
        placeholder="이름 또는 번호로 검색..."
        placeholderTextColor={C.textMuted}
        value={q}
        onChangeText={setQ}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
      />
      {loading ? (
        <Text style={st.loadingText}>연락처 불러오는 중... 🌙</Text>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={i => i.id}
          style={{ flex: 1 }}
          keyboardShouldPersistTaps="handled"   // ← 핵심: 탭해도 키보드 유지
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[st.contactRow, selected?.id === item.id && st.contactRowSelected]}
              onPress={() => onSelect(item)}
            >
              <View style={[st.contactAvatar, selected?.id === item.id && { backgroundColor: C.gold }]}>
                <Text style={st.contactAvatarText}>{item.name?.[0] || '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.contactName}>{item.name}</Text>
                <Text style={st.contactPhone}>{item.phoneNumbers?.[0]?.number}</Text>
              </View>
              {selected?.id === item.id && (
                <Text style={{ color: C.gold, fontSize: 18 }}>✓</Text>
              )}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
};

// 시간 선택기
const TimeSelector = ({ selected, onSelect, custom, onCustom }) => (
  <View>
    <View style={st.presetRow}>
      {PRESET_HOURS.map(p => (
        <TouchableOpacity
          key={String(p.value)}
          style={[st.presetBtn, selected === p.value && st.presetBtnSelected]}
          onPress={() => { onSelect(p.value); onCustom(''); }}
        >
          <Text style={st.presetEmoji}>{p.emoji}</Text>
          <Text style={[st.presetLabel, selected === p.value && { color: C.gold }]}>
            {p.label}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
    <TextInput
      style={st.customInput}
      placeholder="직접 입력 (시간 단위, 예: 5)"
      placeholderTextColor={C.textMuted}
      keyboardType="numeric"
      value={custom}
      onChangeText={v => { onCustom(v); onSelect(null); }}
      returnKeyType="done"
    />
  </View>
);

// ─── 각 탭 스크린 (App 밖 정의 → 리렌더링 시 재생성 안 됨) ──

const HomeScreen = ({ protectedList, scheduleList, stats, setTab, tryUnlock }) => {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const moonAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      Animated.loop(Animated.sequence([
        Animated.timing(moonAnim, { toValue: 7, duration: 3200, useNativeDriver: true }),
        Animated.timing(moonAnim, { toValue: 0, duration: 3200, useNativeDriver: true }),
      ]))
    ]).start();
  }, []);

  const activeProtections = protectedList.filter(c => c.status === 'protected');

  return (
    <Animated.ScrollView style={{ opacity: fadeAnim }} showsVerticalScrollIndicator={false}>
      <StarBg />
      <Animated.View style={[st.homeHeader, { transform: [{ translateY: moonAnim }] }]}>
        <Text style={st.moonEmoji}>🌙</Text>
        <Text style={st.appTitle}>알콜노콜</Text>
        <Text style={st.appSub}>술김에 연락하지 않도록 도와드려요</Text>
      </Animated.View>

      <View style={st.statsRow}>
        <View style={[st.statCard, { flex: 1, marginRight: 8 }]}>
          <Text style={st.statNum}>{stats.total}</Text>
          <Text style={st.statLbl}>총 보호 횟수</Text>
        </View>
        <View style={[st.statCard, { flex: 1, marginLeft: 8 }]}>
          <Text style={st.statNum}>{activeProtections.length}</Text>
          <Text style={st.statLbl}>보호 중</Text>
        </View>
      </View>

      {activeProtections.length > 0 ? (
        <View style={st.section}>
          <Text style={st.sectionTitle}>🛡️ 보호 중인 번호</Text>
          {activeProtections.map(item => (
            <View key={item.id} style={st.protectedCard}>
              <View style={st.protectedAvatar}>
                <Text style={st.protectedAvatarText}>{item.name?.[0] || '?'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                  <Text style={st.protectedName}>{item.name}</Text>
                  {item.locked && <Text style={{ fontSize: 12, marginLeft: 6 }}>🔐</Text>}
                </View>
                <Text style={st.protectedPhone}>●●●●-●●●●</Text>
                <Text style={st.protectedTime}>{getTimeRemaining(item.restoreAt)}</Text>
              </View>
              <TouchableOpacity style={st.unlockBtn} onPress={() => tryUnlock(item)}>
                <Text style={st.unlockBtnText}>해제</Text>
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : (
        <View style={st.emptyCard}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>😴</Text>
          <Text style={st.emptyTitle}>보호 중인 번호가 없어요</Text>
          <Text style={st.emptySub}>술 마시기 전에 미리 등록해두세요</Text>
          <TouchableOpacity style={st.emptyBtn} onPress={() => setTab('add')}>
            <Text style={st.emptyBtnText}>번호 보호하기 →</Text>
          </TouchableOpacity>
        </View>
      )}

      {scheduleList.length > 0 && (
        <View style={st.section}>
          <Text style={st.sectionTitle}>⏰ 예약된 보호</Text>
          {scheduleList.map(item => (
            <View key={item.id} style={st.scheduleCard}>
              <Text style={st.scheduleName}>{item.name}</Text>
              <Text style={st.scheduleTime}>{formatDate(item.startAt)} 시작 예정</Text>
            </View>
          ))}
        </View>
      )}

      <View style={st.infoCard}>
        <Text style={st.infoTitle}>💬 카카오 보이스톡은?</Text>
        <Text style={st.infoText}>
          카카오톡 내부 통화는 기술적으로 차단이 불가능해요.{'\n'}
          대신 카카오 설정에서 해당 친구를 차단하는 방법을 추천해요.
        </Text>
        <Text style={st.infoSub}>카카오톡 → 친구 → 차단 친구 관리</Text>
      </View>

      <TouchableOpacity
        style={st.contactDevBtn}
        onPress={() => Linking.openURL(
          'mailto:sujinsub@naver.com?subject=알콜노콜 문의&body=안녕하세요, 알콜노콜 관련 문의드립니다.\n\n'
        ).catch(() => Alert.alert('오류', '메일 앱을 열 수 없어요 😥'))}
      >
        <Text style={st.contactDevIcon}>✉️</Text>
        <View>
          <Text style={st.contactDevTitle}>개발자에게 요청하기</Text>
          <Text style={st.contactDevSub}>sujinsub@naver.com</Text>
        </View>
      </TouchableOpacity>

      <View style={{ height: 120 }} />
    </Animated.ScrollView>
  );
};

const AddScreen = ({ contacts, loadingContacts, onProtect }) => {
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedHours, setSelectedHours]     = useState(null);
  const [customHours, setCustomHours]         = useState('');
  const [lockEnabled, setLockEnabled]         = useState(false);
  const [lockPin, setLockPin]                 = useState('');

  const handleProtect = () => {
    if (!selectedContact) return Alert.alert('연락처를 선택해주세요 🙏');
    const restoreAt = getRestoreTime(selectedHours, customHours);
    if (!restoreAt) return Alert.alert('보호 시간을 설정해주세요 ⏰');
    if (lockEnabled && lockPin.length < 4)
      return Alert.alert('PIN은 4자리 이상으로 설정해주세요 🔐');

    const hoursNum = selectedHours === 'tomorrow7'
      ? Math.ceil((restoreAt - Date.now()) / 3600000)
      : (customHours ? parseInt(customHours) : selectedHours);

    onProtect({ selectedContact, restoreAt, hoursNum, lockEnabled, lockPin });

    // 입력 초기화
    setSelectedContact(null);
    setSelectedHours(null);
    setCustomHours('');
    setLockEnabled(false);
    setLockPin('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={st.screenTitle}>🔒 번호 보호하기</Text>
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={st.stepLabel}>1. 연락처 선택</Text>
        {selectedContact && (
          <View style={st.selectedBadge}>
            <Text style={st.selectedBadgeText}>✓ {selectedContact.name} 선택됨</Text>
            <TouchableOpacity onPress={() => setSelectedContact(null)}>
              <Text style={{ color: C.red, fontWeight: '700' }}>변경</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={{ height: 260 }}>
          <ContactPicker
            contacts={contacts}
            loading={loadingContacts}
            selected={selectedContact}
            onSelect={setSelectedContact}
          />
        </View>

        <Text style={[st.stepLabel, { marginTop: 16 }]}>2. 보호 시간</Text>
        <TimeSelector
          selected={selectedHours} onSelect={setSelectedHours}
          custom={customHours}     onCustom={setCustomHours}
        />

        <Text style={[st.stepLabel, { marginTop: 16 }]}>3. 잠금 설정 (선택)</Text>
        <View style={st.lockRow}>
          <View>
            <Text style={st.lockTitle}>해제 잠금 🔐</Text>
            <Text style={st.lockSub}>PIN 없이는 보호 해제 불가능</Text>
          </View>
          <Switch
            value={lockEnabled}
            onValueChange={setLockEnabled}
            trackColor={{ false: C.border, true: C.goldSoft }}
            thumbColor={lockEnabled ? C.gold : C.textMuted}
          />
        </View>
        {lockEnabled && (
          <TextInput
            style={[st.customInput, { marginTop: 8 }]}
            placeholder="PIN 번호 설정 (4자리 이상)"
            placeholderTextColor={C.textMuted}
            keyboardType="numeric"
            secureTextEntry
            value={lockPin}
            onChangeText={setLockPin}
            returnKeyType="done"
          />
        )}

        <TouchableOpacity style={st.actionBtn} onPress={handleProtect}>
          <Text style={st.actionBtnText}>🔒 보호 시작하기</Text>
        </TouchableOpacity>
        <View style={{ height: 120 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const ScheduleScreen = ({ contacts, loadingContacts, scheduleList, onAddSchedule, onDeleteSchedule }) => {
  const [schedContact, setSchedContact]   = useState(null);
  const [schedHours, setSchedHours]       = useState(null);
  const [schedCustom, setSchedCustom]     = useState('');
  const [schedDateTime, setSchedDateTime] = useState('');

  const handleAdd = () => {
    if (!schedContact) return Alert.alert('연락처를 선택해주세요 🙏');
    const restoreAt = getRestoreTime(schedHours, schedCustom);
    if (!restoreAt) return Alert.alert('보호 시간을 설정해주세요 ⏰');
    if (!schedDateTime) return Alert.alert('예약 시작 시간을 입력해주세요\n형식: 2024-12-31 22:00');
    const startAt = new Date(schedDateTime).getTime();
    if (isNaN(startAt)) return Alert.alert('시간 형식을 확인해주세요\n예: 2024-12-31 22:00');

    const hoursNum = schedCustom
      ? parseInt(schedCustom)
      : schedHours === 'tomorrow7' ? 8 : schedHours;

    onAddSchedule({ schedContact, startAt, hoursNum });
    setSchedContact(null);
    setSchedHours(null);
    setSchedCustom('');
    setSchedDateTime('');
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Text style={st.screenTitle}>⏰ 보호 예약하기</Text>
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <Text style={st.infoText2}>
          술 마시기 전에 미리 예약해두세요.{'\n'}지정한 시간에 자동으로 보호가 시작돼요.
        </Text>

        <Text style={st.stepLabel}>1. 연락처 선택</Text>
        {schedContact && (
          <View style={st.selectedBadge}>
            <Text style={st.selectedBadgeText}>✓ {schedContact.name} 선택됨</Text>
            <TouchableOpacity onPress={() => setSchedContact(null)}>
              <Text style={{ color: C.red, fontWeight: '700' }}>변경</Text>
            </TouchableOpacity>
          </View>
        )}
        <View style={{ height: 220 }}>
          <ContactPicker
            contacts={contacts}
            loading={loadingContacts}
            selected={schedContact}
            onSelect={setSchedContact}
          />
        </View>

        <Text style={[st.stepLabel, { marginTop: 16 }]}>2. 예약 시작 시간</Text>
        <TextInput
          style={st.customInput}
          placeholder="예: 2024-12-31 22:00"
          placeholderTextColor={C.textMuted}
          value={schedDateTime}
          onChangeText={setSchedDateTime}
          returnKeyType="done"
        />

        <Text style={[st.stepLabel, { marginTop: 16 }]}>3. 보호 지속 시간</Text>
        <TimeSelector
          selected={schedHours} onSelect={setSchedHours}
          custom={schedCustom}  onCustom={setSchedCustom}
        />

        <TouchableOpacity style={st.actionBtn} onPress={handleAdd}>
          <Text style={st.actionBtnText}>⏰ 예약 등록하기</Text>
        </TouchableOpacity>

        {scheduleList.length > 0 && (
          <View style={[st.section, { marginTop: 24 }]}>
            <Text style={st.sectionTitle}>등록된 예약</Text>
            {scheduleList.map(item => (
              <View key={item.id} style={st.scheduleCard}>
                <View style={{ flex: 1 }}>
                  <Text style={st.scheduleName}>{item.name}</Text>
                  <Text style={st.scheduleTime}>{formatDate(item.startAt)} 시작</Text>
                </View>
                <TouchableOpacity onPress={() => onDeleteSchedule(item.id)}>
                  <Text style={{ color: C.red, fontWeight: '700' }}>삭제</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
        <View style={{ height: 120 }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
};

const StatsScreen = ({ stats }) => (
  <ScrollView showsVerticalScrollIndicator={false}>
    <Text style={st.screenTitle}>📊 나의 기록</Text>
    <View style={st.statsRow}>
      <View style={[st.statCard, { flex: 1, marginRight: 8 }]}>
        <Text style={st.statNum}>{stats.total}</Text>
        <Text style={st.statLbl}>총 보호 횟수</Text>
      </View>
      <View style={[st.statCard, { flex: 1, marginLeft: 8 }]}>
        <Text style={st.statNum}>{stats.totalHours}h</Text>
        <Text style={st.statLbl}>총 보호 시간</Text>
      </View>
    </View>
    <View style={[st.statCard, { marginBottom: 20 }]}>
      <Text style={st.statNum}>
        {stats.total > 0 ? (stats.totalHours / stats.total).toFixed(1) : 0}h
      </Text>
      <Text style={st.statLbl}>평균 보호 시간</Text>
    </View>

    {(stats.history || []).length > 0 ? (
      <View style={st.section}>
        <Text style={st.sectionTitle}>최근 보호 기록</Text>
        {(stats.history || []).map((h, i) => (
          <View key={i} style={st.historyRow}>
            <View style={st.protectedAvatar}>
              <Text style={st.protectedAvatarText}>{h.name?.[0] || '?'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.contactName}>{h.name}</Text>
              <Text style={st.contactPhone}>{formatDate(h.at)}</Text>
            </View>
            <Text style={st.historyHours}>{h.hours}시간</Text>
          </View>
        ))}
      </View>
    ) : (
      <View style={st.emptyCard}>
        <Text style={{ fontSize: 40, marginBottom: 12 }}>📭</Text>
        <Text style={st.emptyTitle}>기록이 없어요</Text>
        <Text style={st.emptySub}>번호를 보호하면 여기에 기록돼요</Text>
      </View>
    )}
    <TouchableOpacity
      style={st.contactDevBtn}
      onPress={() =>
        Linking.openURL(
          'mailto:sujinsub@naver.com?subject=알콜노콜 문의&body=안녕하세요, 알콜노콜 관련 문의드립니다.\n\n'
        ).catch(() => Alert.alert('오류', '메일 앱을 열 수 없어요 😥'))
      }
    >
      <Text style={st.contactDevIcon}>✉️</Text>
      <View>
        <Text style={st.contactDevTitle}>개발자에게 요청하기</Text>
        <Text style={st.contactDevSub}>sujinsub@naver.com</Text>
      </View>
    </TouchableOpacity>

    <View style={{ height: 120 }} />
  </ScrollView>
);

// ─── 메인 App (상태 관리만 담당) ──────────────────────

export default function App() {
  const [tab, setTab]                   = useState('home');
  const [protectedList, setProtectedList] = useState([]);
  const [scheduleList, setScheduleList]   = useState([]);
  const [stats, setStats]               = useState({ total: 0, totalHours: 0, history: [] });
  const [contacts, setContacts]         = useState([]);
  const [loadingContacts, setLoadingContacts] = useState(false);
  const [contactsLoaded, setContactsLoaded]   = useState(false);
  const [lockModalVisible, setLockModalVisible] = useState(false);
  const [lockInput, setLockInput]       = useState('');
  const [pendingUnlock, setPendingUnlock] = useState(null);
  const [adLoading, setAdLoading]       = useState(false);
  const interstitialRef = useRef(null);

  useEffect(() => {
    loadAll();
    const interval = setInterval(checkExpired, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (tab === 'add' || tab === 'schedule') loadContacts();
  }, [tab]);

  const loadAll = async () => {
    try {
      const p  = await AsyncStorage.getItem('protected');
      const sc = await AsyncStorage.getItem('schedule');
      const s  = await AsyncStorage.getItem('stats');
      if (p)  setProtectedList(JSON.parse(p));
      if (sc) setScheduleList(JSON.parse(sc));
      if (s)  setStats(JSON.parse(s));
    } catch (e) {}
  };

  const saveProtected = async (list) => {
    setProtectedList(list);
    await AsyncStorage.setItem('protected', JSON.stringify(list));
  };

  const saveSchedule = async (list) => {
    setScheduleList(list);
    await AsyncStorage.setItem('schedule', JSON.stringify(list));
  };

  const saveStats = async (s) => {
    setStats(s);
    await AsyncStorage.setItem('stats', JSON.stringify(s));
  };

  const checkExpired = async () => {
    try {
      const p = await AsyncStorage.getItem('protected');
      if (!p) return;
      const list = JSON.parse(p);
      const now = Date.now();
      let changed = false;
      const updated = list.map(c => {
        if (c.status === 'protected' && now >= c.restoreAt) {
          changed = true;
          return { ...c, status: 'expired' };
        }
        return c;
      });
      if (changed) saveProtected(updated);
    } catch (e) {}
  };

  const loadContacts = async () => {
    if (contactsLoaded) return;
    setLoadingContacts(true);
    try {
      const { status } = await Contacts.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('권한 필요', '연락처 접근 권한이 필요해요 🙏');
        setLoadingContacts(false);
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [Contacts.Fields.PhoneNumbers, Contacts.Fields.Name],
      });
      setContacts(data.filter(c => c.phoneNumbers?.length > 0));
      setContactsLoaded(true);
    } catch (e) {
      Alert.alert('오류', '연락처를 불러오지 못했어요');
    }
    setLoadingContacts(false);
  };

  // 보호 시작 (AddScreen에서 호출)
  const handleProtect = useCallback(async ({ selectedContact, restoreAt, hoursNum, lockEnabled, lockPin }) => {
    const fullName = selectedContact.name || '';
    const nameParts = fullName.trim().split(' ');
    const firstName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : nameParts[0];
    const lastName  = nameParts.length > 1 ? nameParts[0] : '';

    const item = {
      id: Date.now().toString(),
      contactId: selectedContact.id,
      name: fullName,
      firstName,
      lastName,
      phone: selectedContact.phoneNumbers[0].number,
      protectedAt: Date.now(),
      restoreAt,
      hoursNum,
      status: 'protected',
      locked: lockEnabled,
      pin: lockEnabled ? lockPin : null,
    };

    // 연락처 삭제 시도 (실패해도 앱 내부에서는 보호 처리)
    try { await Contacts.removeContactAsync(selectedContact.id); } catch (e) {}

    // 알림 예약 (실패해도 계속 진행)
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🌅 알콜노콜 - 보호 해제됐어요',
          body: `${selectedContact.name} 번호가 복구됐어요. 잘 자고 일어났죠? 😊`,
        },
        trigger: { seconds: Math.max(hoursNum * 3600, 10) },
      });
    } catch (e) {}

    await saveProtected([...protectedList, item]);

    const newStats = {
      total: stats.total + 1,
      totalHours: stats.totalHours + hoursNum,
      history: [
        { name: item.name, at: item.protectedAt, hours: hoursNum },
        ...(stats.history || [])
      ].slice(0, 50),
    };
    await saveStats(newStats);
    setTab('home');

    // 보호 완료 후 통화기록 삭제 안내
    Alert.alert(
      '🔒 보호 시작됐어요',
      `${item.name}의 번호가 숨겨졌어요.\n${hoursNum}시간 후 복구됩니다.\n\n오늘 밤도 무탈하길 🌙`,
      [
        {
          text: '통화기록도 지울게요 📞',
          onPress: () => {
            Alert.alert(
              '📞 통화기록 삭제 방법',
              '앱에서 직접 삭제는 기술적으로 불가능해요.\n\n전화 앱을 열어서 직접 삭제해주세요!\n(해당 번호 기록을 길게 누르면 삭제 옵션이 나와요)',
              [
                {
                  text: '전화 앱 열기',
                  onPress: () => Linking.openURL('tel:').catch(() => {}),
                },
                { text: '직접 할게요', style: 'cancel' },
              ]
            );
          },
        },
        { text: '괜찮아요', style: 'cancel' },
      ]
    );
  }, [protectedList, stats]);

  // 해제 시도
  const tryUnlock = useCallback((item) => {
    if (item.locked) {
      setPendingUnlock(item);
      setLockInput('');
      setLockModalVisible(true);
    } else {
      confirmRestore(item);
    }
  }, []);

  // 광고 보여주고 완료 후 콜백 실행
  const showAdThenCallback = async (callback) => {
    if (!InterstitialAd || !AdEventType) {
      // AdMob 없으면 더미 광고 - 3초 후 자동 닫힘
      setAdLoading(true);
      setTimeout(() => {
        setAdLoading(false);
        callback();
      }, 3000);
      return;
    }

    try {
      setAdLoading(true);

      // 10초 안에 광고 안 뜨면 그냥 진행
      const timeout = setTimeout(() => {
        setAdLoading(false);
        callback();
      }, 10000);

      const ad = InterstitialAd.createForAdRequest(ADMOB_UNIT_ID, {
        requestNonPersonalizedAdsOnly: true,
      });

      ad.addAdEventListener(AdEventType.LOADED, () => {
        clearTimeout(timeout);
        ad.show();
      });

      ad.addAdEventListener(AdEventType.CLOSED, () => {
        setAdLoading(false);
        callback();
      });

      ad.addAdEventListener(AdEventType.ERROR, () => {
        // 광고 로드 실패해도 그냥 진행
        setAdLoading(false);
        callback();
      });

      ad.load();
    } catch (e) {
      setAdLoading(false);
      callback();
    }
  };

  const confirmLockUnlock = () => {
    if (lockInput !== pendingUnlock.pin) {
      Alert.alert('❌ PIN이 틀렸어요', '술 마신 것 맞죠? 😅');
      return;
    }
    setLockModalVisible(false);
    // PIN 맞으면 광고 먼저 보고 복구
    showAdThenCallback(() => confirmRestore(pendingUnlock));
  };

  const confirmRestore = (item) => {
    Alert.alert(
      '정말 복구할까요? 🤔',
      '아직 덜 깬 것 같은데...\n진짜로 번호 복구할거예요?',
      [
        { text: '그만둘게요', style: 'cancel' },
        { text: '복구해요', style: 'destructive', onPress: () => restoreContact(item) },
      ]
    );
  };

  const restoreContact = async (item) => {
    try {
      await Contacts.addContactAsync({
        firstName: item.firstName || item.name,
        lastName: item.lastName || '',
        phoneNumbers: [{ number: item.phone, label: 'mobile', isPrimary: true }],
      });
    } catch (e) {
      console.log('복구 오류:', e);
    }
    await saveProtected(protectedList.filter(c => c.id !== item.id));
    Alert.alert('✅ 복구됐어요', '번호가 돌아왔어요. 후회는 없겠죠? 😬');
  };

  // 예약 추가
  const handleAddSchedule = useCallback(({ schedContact, startAt, hoursNum }) => {
    const item = {
      id: Date.now().toString(),
      name: schedContact.name,
      phone: schedContact.phoneNumbers[0].number,
      startAt,
      restoreHours: hoursNum,
      createdAt: Date.now(),
    };
    try {
      Notifications.scheduleNotificationAsync({
        content: {
          title: '🔒 알콜노콜 - 예약 보호 시작',
          body: `${schedContact.name} 번호 보호가 시작됐어요!`,
        },
        trigger: { date: new Date(startAt) },
      });
    } catch (e) {}
    saveSchedule([...scheduleList, item]);
    Alert.alert('⏰ 예약됐어요', `${formatDate(startAt)}에 보호가 시작돼요!`);
  }, [scheduleList]);

  const handleDeleteSchedule = useCallback((id) => {
    Alert.alert('예약 삭제', '이 예약을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () =>
          saveSchedule(scheduleList.filter(s => s.id !== id))
      },
    ]);
  }, [scheduleList]);

  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor={C.bg} />
      <View style={st.content}>
        {tab === 'home' && (
          <HomeScreen
            protectedList={protectedList}
            scheduleList={scheduleList}
            stats={stats}
            setTab={setTab}
            tryUnlock={tryUnlock}
          />
        )}
        {tab === 'add' && (
          <AddScreen
            contacts={contacts}
            loadingContacts={loadingContacts}
            onProtect={handleProtect}
          />
        )}
        {tab === 'schedule' && (
          <ScheduleScreen
            contacts={contacts}
            loadingContacts={loadingContacts}
            scheduleList={scheduleList}
            onAddSchedule={handleAddSchedule}
            onDeleteSchedule={handleDeleteSchedule}
          />
        )}
        {tab === 'stats' && <StatsScreen stats={stats} />}
      </View>
      <TabBar tab={tab} setTab={setTab} />

      {/* 광고 로딩 오버레이 */}
      <Modal visible={adLoading} transparent animationType="fade">
        <View style={st.modalOverlay}>
          <View style={[st.modalBox, { alignItems: 'center', paddingVertical: 36 }]}>
            <Text style={{ fontSize: 40, marginBottom: 16 }}>📺</Text>
            <Text style={st.modalTitle}>잠깐만요!</Text>
            <Text style={st.modalSub}>{'광고를 불러오는 중이에요...\n보고 나면 바로 해제돼요 😊'}</Text>
          </View>
        </View>
      </Modal>

      {/* PIN 잠금 해제 모달 */}
      <Modal visible={lockModalVisible} transparent animationType="fade">
        <View style={st.modalOverlay}>
          <View style={st.modalBox}>
            <Text style={st.modalTitle}>🔐 잠금 해제</Text>
            <Text style={st.modalSub}>PIN 번호를 입력해야 해제돼요</Text>
            <TextInput
              style={st.modalInput}
              placeholder="PIN 번호"
              placeholderTextColor={C.textMuted}
              keyboardType="numeric"
              secureTextEntry
              value={lockInput}
              onChangeText={setLockInput}
              returnKeyType="done"
              onSubmitEditing={confirmLockUnlock}
            />
            <View style={st.modalBtns}>
              <TouchableOpacity
                style={[st.modalBtn, { backgroundColor: C.border }]}
                onPress={() => setLockModalVisible(false)}
              >
                <Text style={{ color: C.text, fontWeight: '700' }}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[st.modalBtn, { backgroundColor: C.gold }]}
                onPress={confirmLockUnlock}
              >
                <Text style={{ color: C.bg, fontWeight: '700' }}>확인</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ─── 스타일 ──────────────────────────────────────────
const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 56 },

  tabBar: {
    flexDirection: 'row', backgroundColor: C.bgCard,
    borderTopWidth: 1, borderTopColor: C.border,
    paddingBottom: Platform.OS === 'ios' ? 24 : 10,
    paddingTop: 10,
  },
  tabItem: { flex: 1, alignItems: 'center', position: 'relative' },
  tabEmoji: { fontSize: 20 },
  tabLabel: { fontSize: 11, color: C.textMuted, marginTop: 2 },
  tabLabelActive: { color: C.gold, fontWeight: '700' },
  tabDot: {
    position: 'absolute', bottom: -4, width: 4, height: 4,
    borderRadius: 2, backgroundColor: C.gold,
  },

  homeHeader: { alignItems: 'center', paddingVertical: 32 },
  moonEmoji: { fontSize: 64 },
  appTitle: { fontSize: 34, fontWeight: '900', color: C.moonWhite, letterSpacing: -1.5, marginTop: 12 },
  appSub: { fontSize: 13, color: C.textMuted, marginTop: 6 },

  statsRow: { flexDirection: 'row', marginBottom: 16 },
  statCard: {
    backgroundColor: C.bgCard, borderRadius: 16, padding: 20,
    alignItems: 'center', borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  statNum: { fontSize: 28, fontWeight: '900', color: C.gold },
  statLbl: { fontSize: 12, color: C.textMuted, marginTop: 4 },

  section: { marginBottom: 20 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: C.text, marginBottom: 12 },

  protectedCard: {
    backgroundColor: C.bgCard, borderRadius: 14, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: C.borderGold,
  },
  protectedAvatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
    borderWidth: 1, borderColor: C.gold,
  },
  protectedAvatarText: { color: C.gold, fontWeight: '800', fontSize: 17 },
  protectedName: { fontSize: 15, fontWeight: '700', color: C.moonWhite },
  protectedPhone: { fontSize: 12, color: C.textMuted, marginTop: 2 },
  protectedTime: { fontSize: 12, color: C.gold, marginTop: 4 },
  unlockBtn: {
    borderWidth: 1, borderColor: C.red, borderRadius: 10,
    paddingHorizontal: 12, paddingVertical: 6, backgroundColor: C.redSoft,
  },
  unlockBtnText: { color: C.red, fontWeight: '700', fontSize: 13 },

  emptyCard: {
    backgroundColor: C.bgCard, borderRadius: 20, padding: 32,
    alignItems: 'center', borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: C.text },
  emptySub: { fontSize: 13, color: C.textMuted, marginTop: 6, textAlign: 'center' },
  emptyBtn: {
    marginTop: 16, paddingHorizontal: 20, paddingVertical: 10,
    backgroundColor: C.goldSoft, borderRadius: 12, borderWidth: 1, borderColor: C.gold,
  },
  emptyBtnText: { color: C.gold, fontWeight: '700' },

  infoCard: {
    backgroundColor: C.bgCardAlt, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.border, marginBottom: 16,
  },
  infoTitle: { fontSize: 14, fontWeight: '700', color: C.text, marginBottom: 6 },
  infoText: { fontSize: 13, color: C.textMuted, lineHeight: 20 },
  infoText2: { fontSize: 13, color: C.textMuted, marginBottom: 16, lineHeight: 20 },
  infoSub: { fontSize: 12, color: C.blue, marginTop: 6 },

  screenTitle: { fontSize: 22, fontWeight: '900', color: C.moonWhite, marginBottom: 20, letterSpacing: -0.5 },
  stepLabel: { fontSize: 13, fontWeight: '700', color: C.gold, marginBottom: 10 },

  searchInput: {
    backgroundColor: C.bgCard, borderRadius: 12, padding: 12,
    color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border, marginBottom: 8,
  },
  customInput: {
    backgroundColor: C.bgCard, borderRadius: 12, padding: 12,
    color: C.text, fontSize: 15, borderWidth: 1, borderColor: C.border,
  },
  loadingText: { color: C.textMuted, textAlign: 'center', marginTop: 20, fontSize: 15 },

  selectedBadge: {
    backgroundColor: C.greenSoft, borderRadius: 10, padding: 10, marginBottom: 8,
    borderWidth: 1, borderColor: C.green, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
  },
  selectedBadgeText: { color: C.green, fontWeight: '700', fontSize: 13 },

  contactRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  contactRowSelected: {
    backgroundColor: C.goldSoft, borderRadius: 10,
    paddingHorizontal: 8, borderBottomWidth: 0,
  },
  contactAvatar: {
    width: 38, height: 38, borderRadius: 19, backgroundColor: C.navy,
    alignItems: 'center', justifyContent: 'center', marginRight: 10,
  },
  contactAvatarText: { color: C.text, fontWeight: '700', fontSize: 15 },
  contactName: { fontSize: 14, fontWeight: '600', color: C.text },
  contactPhone: { fontSize: 12, color: C.textMuted },

  presetRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  presetBtn: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12,
    backgroundColor: C.bgCard, borderWidth: 1, borderColor: C.border, alignItems: 'center',
  },
  presetBtnSelected: { borderColor: C.gold, backgroundColor: C.goldSoft },
  presetEmoji: { fontSize: 16 },
  presetLabel: { fontSize: 12, color: C.textMuted, marginTop: 3, fontWeight: '600' },

  lockRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: C.bgCard, borderRadius: 12, padding: 14,
    borderWidth: 1, borderColor: C.border,
  },
  lockTitle: { fontSize: 14, fontWeight: '700', color: C.text },
  lockSub: { fontSize: 12, color: C.textMuted, marginTop: 2 },

  actionBtn: {
    backgroundColor: C.gold, borderRadius: 16, padding: 18,
    alignItems: 'center', marginTop: 20,
  },
  actionBtnText: { color: C.bg, fontSize: 16, fontWeight: '900' },

  scheduleCard: {
    backgroundColor: C.bgCard, borderRadius: 12, padding: 14, marginBottom: 8,
    borderWidth: 1, borderColor: C.border, flexDirection: 'row', alignItems: 'center',
  },
  scheduleName: { fontSize: 14, fontWeight: '700', color: C.text },
  scheduleTime: { fontSize: 12, color: C.textMuted, marginTop: 3 },

  historyRow: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: C.border,
  },
  historyHours: { color: C.gold, fontWeight: '700', fontSize: 14 },

  modalOverlay: {
    flex: 1, backgroundColor: '#00000099',
    justifyContent: 'center', alignItems: 'center',
  },
  modalBox: {
    backgroundColor: C.bgCard, borderRadius: 20, padding: 24,
    width: width * 0.85, borderWidth: 1, borderColor: C.borderGold,
  },
  modalTitle: { fontSize: 18, fontWeight: '900', color: C.moonWhite, marginBottom: 6 },
  modalSub: { fontSize: 13, color: C.textMuted, marginBottom: 16 },
  modalInput: {
    backgroundColor: C.bg, borderRadius: 12, padding: 12,
    color: C.text, fontSize: 18, borderWidth: 1, borderColor: C.border,
    marginBottom: 16, textAlign: 'center', letterSpacing: 6,
  },
  modalBtns: { flexDirection: 'row', gap: 10 },
  modalBtn: { flex: 1, padding: 14, borderRadius: 12, alignItems: 'center' },

  contactDevBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: C.bgCard, borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: C.borderGold, marginBottom: 16,
  },
  contactDevIcon: { fontSize: 28 },
  contactDevTitle: { fontSize: 14, fontWeight: '700', color: C.moonWhite },
  contactDevSub: { fontSize: 12, color: C.gold, marginTop: 2 },
});
